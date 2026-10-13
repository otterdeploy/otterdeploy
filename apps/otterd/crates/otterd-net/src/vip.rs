//! Stable service addresses: the receiver's forwarding state and its nftables rendering.
//!
//! **Kernel-expiring eligibility.** Every eligible backend attempt is an element in its own
//! `alive` set whose timeout is the remaining owner lease (`q + TTL − now`). Expiry happens in
//! the kernel even if this process is frozen, so a crashed owner stops receiving new flows within
//! the lease bound. The pick is mark-free: `numgen random mod N vmap` jumps into one chain per
//! backend, each guarded by its `alive` set; a miss falls through to alive-only fallbacks, so a
//! single expired backend never refuses flows a healthy one could take (a single map with
//! per-element timeouts refused about half the new flows while one lease had expired).
//!
//! **Fail-closed by design.** The same expiry means a frozen receiver refuses new flows
//! once its leases run out, even for healthy owners. The reconcile loop pets the watchdog only
//! after a completed pass, so a wedged receiver is restarted well before that.
//!
//! **Refusal, not timeouts.** Packets to a VIP that were not DNAT'd (no eligible backend, or
//! invalid mid-stream TCP after a drain) are rejected: TCP reset, UDP port-unreachable. Only
//! connected UDP sockets see the latter; unconnected UDP clients time out (Linux does not report
//! ICMP errors to them), and local senders get `EPERM`.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::net::Ipv4Addr;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use otterd_proto::discovery::{ELIGIBILITY_TTL_MS, MAX_DRAIN_MS, OwnerSnapshot, ServingSet};
use otterd_proto::ids::{AttemptId, NodeId, VipId};

use crate::policy::Proto;

/// Table the receiver owns.
pub const TABLE: &str = "otterd_vip";

/// One VIP port and the backend port it maps to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortMap {
    /// Protocol.
    pub proto: Proto,
    /// Port on the VIP.
    pub port: u16,
    /// Port on the backend.
    pub target: u16,
}

/// An eligible backend attempt with the time its owner lease has left.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Backend {
    /// Backend address.
    pub addr: Ipv4Addr,
    /// Remaining lease; the kernel drops the element when it runs out.
    #[serde(with = "millis")]
    pub remaining: Duration,
}

mod millis {
    use serde::{Deserialize, Deserializer, Serializer};
    use std::time::Duration;

    pub(super) fn serialize<S: Serializer>(d: &Duration, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_u64(u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
    }

    pub(super) fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Duration, D::Error> {
        Ok(Duration::from_millis(u64::deserialize(d)?))
    }
}

/// A VIP's forwarding view at this receiver.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VipView {
    /// The address.
    pub vip: Ipv4Addr,
    /// Ports.
    pub ports: Vec<PortMap>,
    /// Eligible backends (may be empty: the VIP still exists and refuses fast).
    pub backends: Vec<Backend>,
}

fn proto_kw(p: Proto) -> &'static str {
    match p {
        Proto::Tcp => "tcp",
        Proto::Udp => "udp",
    }
}

/// Renders the receiver table for all VIPs, replaced atomically.
#[must_use]
pub fn render(views: &[VipView]) -> String {
    let mut o = String::with_capacity(1024 + views.len() * 512);
    let _ = writeln!(
        o,
        "add table ip {TABLE}\ndelete table ip {TABLE}\ntable ip {TABLE} {{"
    );
    let vips: BTreeSet<Ipv4Addr> = views.iter().map(|v| v.vip).collect();
    let _ = writeln!(o, "  set vips {{\n    type ipv4_addr");
    if !vips.is_empty() {
        let list: Vec<String> = vips.iter().map(ToString::to_string).collect();
        let _ = writeln!(o, "    elements = {{ {} }}", list.join(", "));
    }
    o.push_str("  }\n");

    let mut select = String::new();
    for (vi, v) in views.iter().enumerate() {
        if v.backends.is_empty() {
            continue;
        }
        for (bi, b) in v.backends.iter().enumerate() {
            let ms = u64::try_from(b.remaining.as_millis())
                .unwrap_or(u64::MAX)
                .max(1);
            let _ = writeln!(
                o,
                "  set alive_{vi}_{bi} {{\n    type ipv4_addr\n    flags timeout\n    elements = {{ {} timeout {ms}ms }}\n  }}",
                v.vip
            );
        }
        for pm in &v.ports {
            let kw = proto_kw(pm.proto);
            for (bi, b) in v.backends.iter().enumerate() {
                let _ = writeln!(
                    o,
                    "  chain pick_{vi}_{bi}_{kw}{p} {{\n    ip daddr @alive_{vi}_{bi} meta l4proto {kw} th dport {p} dnat ip to {a}:{t}\n  }}",
                    p = pm.port,
                    a = b.addr,
                    t = pm.target
                );
            }
            let arms: Vec<String> = (0..v.backends.len())
                .map(|bi| format!("{bi} : jump pick_{vi}_{bi}_{kw}{}", pm.port))
                .collect();
            let _ = writeln!(
                select,
                "    ip daddr {} meta l4proto {kw} th dport {} numgen random mod {} vmap {{ {} }}",
                v.vip,
                pm.port,
                v.backends.len(),
                arms.join(", ")
            );
            for (bi, b) in v.backends.iter().enumerate() {
                let _ = writeln!(
                    select,
                    "    ip daddr @alive_{vi}_{bi} meta l4proto {kw} th dport {} dnat ip to {}:{}",
                    pm.port, b.addr, pm.target
                );
            }
        }
    }
    let _ = write!(o, "  chain select {{\n{select}  }}\n");
    for (chain, hook) in [("out", "output"), ("pre", "prerouting")] {
        let _ = writeln!(
            o,
            "  chain {chain} {{\n    type nat hook {hook} priority -100; policy accept;\n    jump select\n  }}"
        );
    }
    for (chain, hook, prio) in [
        ("refuse_out", "output", "0"),
        ("refuse_pre", "prerouting", "-90"),
    ] {
        let _ = writeln!(
            o,
            "  chain {chain} {{\n    type filter hook {hook} priority {prio}; policy accept;\n    ip daddr @vips meta l4proto tcp reject with tcp reset\n    ip daddr @vips meta l4proto udp reject with icmp type port-unreachable\n  }}"
        );
    }
    o.push_str("}\n");
    o
}

/// Where a VIP lives on the wire: its address (address plan) and port map (service spec).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VipBinding {
    /// The VIP address.
    pub vip: Ipv4Addr,
    /// Ports.
    pub ports: Vec<PortMap>,
}

/// Why a serving set or snapshot was not installed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum Refused {
    /// Not newer than the installed revision (replay or reorder).
    #[error("revision {got} is not newer than installed {have}")]
    StaleRevision {
        /// Offered.
        got: u64,
        /// Installed.
        have: u64,
    },
    /// The set re-admits an attempt this receiver has withdrawn; withdrawal is terminal.
    #[error("attempt {0} was withdrawn; withdrawal is terminal")]
    WithdrawalIsTerminal(AttemptId),
    /// Forwarding is suspended until the latest state is installed (rejoin / new CP term).
    #[error("forwarding suspended until resync")]
    Suspended,
    /// An attempt address is not IPv4 (the workload mesh is IPv4 in this release).
    #[error("attempt {0} has a non-IPv4 address {1:?}")]
    Address(AttemptId, String),
    /// An owner snapshot not above the owner's high-water mark.
    #[error("snapshot from {0} is not newer than the high-water mark")]
    NotNewer(NodeId),
}

/// A withdrawal as installed here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Drain {
    /// Backend address (for conntrack removal at the deadline).
    pub addr: Option<Ipv4Addr>,
    /// The VIP it served.
    pub vip: Ipv4Addr,
    /// Deadline in receiver monotonic milliseconds; never moved by replays.
    pub deadline_ms: u64,
    /// Conntrack state was removed.
    pub done: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Admitted {
    binding: VipBinding,
    revision: u64,
    attempts: Vec<(AttemptId, Ipv4Addr)>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Published {
    /// (node epoch, publisher incarnation, seq): strictly increasing.
    high_water: (u64, u64, u64),
    attempts: BTreeSet<AttemptId>,
}

/// The receiver's durable admission state. Inputs are contract messages whose
/// signatures and digests the caller has verified. Times are receiver-monotonic milliseconds
/// supplied by the caller, which keeps this pure and testable. Persist after every mutation,
/// before applying.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Receiver {
    serving: BTreeMap<VipId, Admitted>,
    owners: BTreeMap<NodeId, Published>,
    withdrawn: BTreeMap<AttemptId, Drain>,
    #[serde(skip)]
    fresh_until: BTreeMap<NodeId, u64>,
    #[serde(skip)]
    path_down: BTreeSet<Ipv4Addr>,
    suspended: bool,
}

impl Receiver {
    /// After a restart: persisted admission survives, owner freshness does not (it must be
    /// re-proven by fresh challenges). If drain timers were lost, drains end now (conservative).
    #[must_use]
    pub fn restarted(mut self, now_ms: u64, timers_lost: bool) -> Self {
        self.fresh_until.clear();
        self.path_down.clear();
        if timers_lost {
            for d in self.withdrawn.values_mut() {
                d.deadline_ms = d.deadline_ms.min(now_ms);
            }
        }
        self
    }

    /// Installs a verified CP serving set for the VIP at `binding`.
    ///
    /// # Errors
    /// [`Refused`]; the previous set stays in force.
    pub fn install(
        &mut self,
        set: &ServingSet,
        binding: VipBinding,
        now_ms: u64,
    ) -> Result<(), Refused> {
        if self.suspended {
            return Err(Refused::Suspended);
        }
        let revision = set.serving_revision.get();
        if let Some(cur) = self.serving.get(&set.vip_id)
            && revision <= cur.revision
        {
            return Err(Refused::StaleRevision {
                got: revision,
                have: cur.revision,
            });
        }
        let mut attempts = Vec::with_capacity(set.new_flow_attempts.len());
        for a in &set.new_flow_attempts {
            if self.withdrawn.contains_key(&a.attempt_id) {
                return Err(Refused::WithdrawalIsTerminal(a.attempt_id.clone()));
            }
            let addr = a
                .address
                .parse()
                .map_err(|_| Refused::Address(a.attempt_id.clone(), a.address.clone()))?;
            attempts.push((a.attempt_id.clone(), addr));
        }
        let previous = self.serving.get(&set.vip_id);
        for w in &set.withdrawals {
            if self.withdrawn.contains_key(&w.attempt_id) {
                continue; // replays never reset or extend a drain
            }
            let addr = previous
                .and_then(|p| p.attempts.iter().find(|(id, _)| *id == w.attempt_id))
                .map(|(_, a)| *a);
            let budget = w.drain_budget_ms.get().min(MAX_DRAIN_MS);
            self.withdrawn.insert(
                w.attempt_id.clone(),
                Drain {
                    addr,
                    vip: binding.vip,
                    deadline_ms: now_ms.saturating_add(budget),
                    done: false,
                },
            );
        }
        self.serving.insert(
            set.vip_id.clone(),
            Admitted {
                binding,
                revision,
                attempts,
            },
        );
        Ok(())
    }

    /// Records an owner's verified full snapshot: data only, never freshness. It replaces the
    /// owner's published set (omission deletes) and must be above the high-water mark.
    ///
    /// # Errors
    /// [`Refused::NotNewer`].
    pub fn owner_snapshot(&mut self, snap: &OwnerSnapshot) -> Result<(), Refused> {
        let mark = (
            snap.node_epoch.get(),
            snap.publisher_incarnation.get(),
            snap.seq.get(),
        );
        if let Some(p) = self.owners.get(&snap.node_id)
            && mark <= p.high_water
        {
            return Err(Refused::NotNewer(snap.node_id.clone()));
        }
        let attempts = snap
            .endpoints
            .iter()
            .map(|e| e.attempt_id.clone())
            .collect();
        self.owners.insert(
            snap.node_id.clone(),
            Published {
                high_water: mark,
                attempts,
            },
        );
        Ok(())
    }

    /// A fresh owner answer to a challenge sent at `q_ms` (already verified: nonce, binding,
    /// window, signature, digest). Freshness runs to `q + TTL`, never receipt + TTL.
    pub fn owner_fresh(&mut self, owner: &NodeId, q_ms: u64) {
        let until = q_ms.saturating_add(ELIGIBILITY_TTL_MS);
        let e = self.fresh_until.entry(owner.clone()).or_default();
        *e = (*e).max(until);
    }

    /// Local path health to a backend address.
    pub fn path_health(&mut self, addr: Ipv4Addr, ok: bool) {
        if ok {
            self.path_down.remove(&addr);
        } else {
            self.path_down.insert(addr);
        }
    }

    /// Suspends forwarding (rejoin, new CP term): the next render has no backends.
    pub fn suspend(&mut self) {
        self.suspended = true;
    }

    /// Resumes after the latest serving sets and tombstones are installed.
    pub fn resume(&mut self) {
        self.suspended = false;
    }

    fn owner_of(&self, attempt: &AttemptId) -> Option<&NodeId> {
        self.owners
            .iter()
            .find(|(_, p)| p.attempts.contains(attempt))
            .map(|(n, _)| n)
    }

    /// The forwarding view at `now_ms`: per VIP, the attempts that are admitted by the CP, not
    /// withdrawn here, published by an owner that is fresh, and path-healthy, each with the time
    /// its owner lease has left.
    #[must_use]
    pub fn views(&self, now_ms: u64) -> Vec<VipView> {
        self.serving
            .values()
            .map(|s| VipView {
                vip: s.binding.vip,
                ports: s.binding.ports.clone(),
                backends: if self.suspended {
                    Vec::new()
                } else {
                    s.attempts
                        .iter()
                        .filter(|(id, addr)| {
                            !self.withdrawn.contains_key(id) && !self.path_down.contains(addr)
                        })
                        .filter_map(|(id, addr)| {
                            let until = *self.fresh_until.get(self.owner_of(id)?)?;
                            (until > now_ms).then(|| Backend {
                                addr: *addr,
                                remaining: Duration::from_millis(until - now_ms),
                            })
                        })
                        .collect()
                },
            })
            .collect()
    }

    /// Drains whose deadline passed and whose conntrack state is not yet removed.
    #[must_use]
    pub fn drains_due(&self, now_ms: u64) -> Vec<(AttemptId, Drain)> {
        self.withdrawn
            .iter()
            .filter(|(_, d)| !d.done && d.deadline_ms <= now_ms)
            .map(|(a, d)| (a.clone(), d.clone()))
            .collect()
    }

    /// Conntrack for a drain was removed.
    pub fn drain_done(&mut self, attempt: &AttemptId) {
        if let Some(d) = self.withdrawn.get_mut(attempt) {
            d.done = true;
        }
    }

    /// Whether this receiver can acknowledge that it no longer forwards to `addr` (endpoint
    /// reuse needs this from every forwarding peer): no admitted attempt uses it and every
    /// drain for it is done.
    #[must_use]
    pub fn released(&self, addr: Ipv4Addr) -> bool {
        let live = self
            .serving
            .values()
            .flat_map(|s| s.attempts.iter())
            .any(|(id, a)| *a == addr && !self.withdrawn.contains_key(id));
        let draining = self
            .withdrawn
            .values()
            .any(|d| d.addr == Some(addr) && !d.done);
        !live && !draining
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use otterd_proto::U53;
    use otterd_proto::discovery::{Endpoint, EndpointPort, ServingAttempt, Withdrawal};
    use otterd_proto::ids::{GrantId, InstallId, ResourceId, ScopeId, Sha256Hex, SlotRef};
    use otterd_proto::spec::PortProtocol;

    const VIP: Ipv4Addr = Ipv4Addr::new(172, 31, 0, 1);

    fn ip(last: u8) -> Ipv4Addr {
        Ipv4Addr::new(172, 24, 0, last)
    }

    fn att(s: &str) -> AttemptId {
        AttemptId::new(s).unwrap()
    }

    fn node(s: &str) -> NodeId {
        NodeId::new(s).unwrap()
    }

    fn binding() -> VipBinding {
        VipBinding {
            vip: VIP,
            ports: vec![PortMap {
                proto: Proto::Tcp,
                port: 80,
                target: 8080,
            }],
        }
    }

    fn set(rev: u64, attempts: &[(&str, u8)], withdrawals: &[&str]) -> ServingSet {
        ServingSet {
            install_id: InstallId::new("i1").unwrap(),
            authority_term: U53::ONE,
            scope_id: ScopeId::new("s1").unwrap(),
            vip_id: VipId::new("v1").unwrap(),
            vip_address: "172.31.0.7".into(),
            names: vec![],
            ports: vec![EndpointPort {
                protocol: PortProtocol::Tcp,
                port: 80,
            }],
            serving_revision: U53::from_const(rev),
            operation_epoch: U53::ONE,
            new_flow_attempts: attempts
                .iter()
                .map(|(a, l)| ServingAttempt {
                    grant_id: GrantId::new("g1").unwrap(),
                    attempt_id: att(a),
                    node_epoch: U53::ONE,
                    address: ip(*l).to_string(),
                    ports: vec![EndpointPort {
                        protocol: PortProtocol::Tcp,
                        port: 8080,
                    }],
                })
                .collect(),
            withdrawals: withdrawals
                .iter()
                .map(|a| Withdrawal {
                    attempt_id: att(a),
                    withdrawal_revision: U53::from_const(rev),
                    drain_budget_ms: U53::from_const(60_000),
                })
                .collect(),
        }
    }

    fn snapshot(owner: &str, seq: u64, attempts: &[&str]) -> OwnerSnapshot {
        OwnerSnapshot {
            node_id: node(owner),
            node_epoch: U53::ONE,
            publisher_incarnation: U53::ONE,
            seq: U53::from_const(seq),
            membership_epoch: U53::ONE,
            placement_revision: U53::ONE,
            full_set_digest: Sha256Hex::digest(b"x"),
            endpoints: attempts
                .iter()
                .map(|a| Endpoint {
                    grant_id: GrantId::new("g1").unwrap(),
                    slot: SlotRef::new(ResourceId::new("r1").unwrap(), 0),
                    generation: U53::ONE,
                    attempt_id: att(a),
                    address: "172.24.0.2".into(),
                    ports: vec![],
                    readiness_revision: U53::ONE,
                    scope_id: ScopeId::new("s1").unwrap(),
                })
                .collect(),
        }
    }

    #[test]
    fn render_is_mark_free_gated_and_refuses_unmatched() {
        let v = VipView {
            vip: VIP,
            ports: vec![
                PortMap {
                    proto: Proto::Tcp,
                    port: 80,
                    target: 8080,
                },
                PortMap {
                    proto: Proto::Udp,
                    port: 53,
                    target: 53,
                },
            ],
            backends: vec![
                Backend {
                    addr: ip(2),
                    remaining: Duration::from_millis(25_500),
                },
                Backend {
                    addr: ip(3),
                    remaining: Duration::ZERO,
                },
            ],
        };
        let t = render(&[v]);
        assert!(
            !t.contains("mark"),
            "no meta mark: WireGuard, Docker and UFW use marks"
        );
        assert!(t.contains("elements = { 172.31.0.1 timeout 25500ms }"));
        assert!(
            t.contains("elements = { 172.31.0.1 timeout 1ms }"),
            "a zero lease still renders, expiring at once"
        );
        assert!(t.contains(
            "numgen random mod 2 vmap { 0 : jump pick_0_0_tcp80, 1 : jump pick_0_1_tcp80 }"
        ));
        assert!(t.contains(
            "ip daddr @alive_0_1 meta l4proto tcp th dport 80 dnat ip to 172.24.0.3:8080"
        ));
        assert!(t.contains("meta l4proto udp th dport 53 numgen random mod 2 vmap"));
        assert!(t.contains("reject with icmp type port-unreachable"));
        let vmap = t.find("vmap { 0 : jump pick_0_0_tcp80").unwrap();
        assert!(
            t[vmap..].contains(
                "\n    ip daddr @alive_0_0 meta l4proto tcp th dport 80 dnat ip to 172.24.0.2:8080\n"
            ),
            "alive-only fallbacks follow the pick in the select chain"
        );
    }

    #[test]
    fn empty_vip_keeps_its_refusal() {
        let t = render(&[VipView {
            vip: VIP,
            ports: vec![],
            backends: vec![],
        }]);
        assert!(t.contains("elements = { 172.31.0.1 }"));
        assert!(!t.contains("numgen"));
    }

    #[test]
    fn eligibility_needs_admission_publication_and_a_fresh_owner_and_expires_at_q_plus_ttl() {
        let mut r = Receiver::default();
        r.install(&set(1, &[("a1", 2), ("a2", 3)], &[]), binding(), 0)
            .unwrap();
        r.owner_fresh(&node("w1"), 1_000);
        assert!(
            r.views(0)[0].backends.is_empty(),
            "admitted and fresh, but not published by its owner"
        );
        r.owner_snapshot(&snapshot("w1", 1, &["a1"])).unwrap();
        let b = &r.views(5_000)[0].backends;
        assert_eq!(b.len(), 1);
        assert_eq!(b[0].remaining, Duration::from_secs(26));
        assert!(
            r.views(31_000)[0].backends.is_empty(),
            "q + 30 s, not receipt + 30 s"
        );
        assert_eq!(
            r.owner_snapshot(&snapshot("w1", 1, &[])),
            Err(Refused::NotNewer(node("w1")))
        );
        r.owner_snapshot(&snapshot("w1", 2, &[])).unwrap();
        r.owner_fresh(&node("w1"), 30_000);
        assert!(
            r.views(31_000)[0].backends.is_empty(),
            "omitted from the owner's full set: deleted"
        );
        r.owner_snapshot(&snapshot("w1", 3, &["a1"])).unwrap();
        r.path_health(ip(2), false);
        assert!(
            r.views(31_000)[0].backends.is_empty(),
            "path down excludes it locally"
        );
    }

    #[test]
    fn withdrawal_is_terminal_and_replays_never_extend_the_drain() {
        let mut r = Receiver::default();
        r.install(&set(1, &[("a1", 2)], &[]), binding(), 0).unwrap();
        r.owner_snapshot(&snapshot("w1", 1, &["a1", "a2"])).unwrap();
        r.owner_fresh(&node("w1"), 0);
        r.install(&set(2, &[("a2", 3)], &["a1"]), binding(), 1_000)
            .unwrap();
        assert_eq!(
            r.views(1_000)[0]
                .backends
                .iter()
                .map(|b| b.addr)
                .collect::<Vec<_>>(),
            vec![ip(3)],
            "new selection moves at once"
        );
        assert_eq!(
            r.install(&set(2, &[], &[]), binding(), 2_000),
            Err(Refused::StaleRevision { got: 2, have: 2 })
        );
        r.install(&set(3, &[("a2", 3)], &["a1"]), binding(), 10_000)
            .unwrap();
        assert_eq!(r.drains_due(30_999).len(), 0);
        let due = r.drains_due(31_000);
        assert_eq!(
            due[0].1.addr,
            Some(ip(2)),
            "capped at 30 s from the first install"
        );
        assert_eq!(
            r.install(&set(4, &[("a1", 2)], &[]), binding(), 40_000),
            Err(Refused::WithdrawalIsTerminal(att("a1")))
        );
        assert!(!r.released(ip(2)));
        r.drain_done(&att("a1"));
        assert!(r.released(ip(2)));
        assert!(!r.released(ip(3)));
    }

    #[test]
    fn restart_forgets_freshness_and_lost_timers_end_drains_now() {
        let mut r = Receiver::default();
        r.install(&set(1, &[("a1", 2)], &[]), binding(), 0).unwrap();
        r.owner_snapshot(&snapshot("w1", 1, &["a1"])).unwrap();
        r.owner_fresh(&node("w1"), 0);
        r.install(&set(2, &[], &["a1"]), binding(), 0).unwrap();
        let text = serde_json::to_string(&r).unwrap();
        let back: Receiver = serde_json::from_str(&text).unwrap();
        assert_eq!(
            back.clone().restarted(5_000, true).drains_due(5_000).len(),
            1
        );
        let mut r2 = Receiver::default();
        r2.install(&set(1, &[("a9", 9)], &[]), binding(), 0)
            .unwrap();
        r2.owner_snapshot(&snapshot("w9", 1, &["a9"])).unwrap();
        r2.owner_fresh(&node("w9"), 0);
        let r2 = r2.restarted(1, false);
        assert!(
            r2.views(1)[0].backends.is_empty(),
            "freshness must be re-proven after restart"
        );
    }

    #[test]
    fn suspended_receiver_forwards_nothing_and_refuses_sets() {
        let mut r = Receiver::default();
        r.install(&set(1, &[("a1", 2)], &[]), binding(), 0).unwrap();
        r.owner_snapshot(&snapshot("w1", 1, &["a1"])).unwrap();
        r.owner_fresh(&node("w1"), 0);
        r.suspend();
        assert!(r.views(1)[0].backends.is_empty());
        assert_eq!(
            r.install(&set(2, &[], &[]), binding(), 1),
            Err(Refused::Suspended)
        );
        r.resume();
        assert_eq!(r.views(1)[0].backends.len(), 1);
    }
}
