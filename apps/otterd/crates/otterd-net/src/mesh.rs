//! The WireGuard mesh: per-pair endpoint selection, NAT requirements, the MTU rule and
//! idempotent interface configuration.
//!
//! Selection is evidence-driven: a path is only chosen after an authenticated handshake test
//! over it succeeded. There is no implicit relay or STUN; two NATed peers need a reachable BYO
//! underlay, an operator-declared mapping, or a public hub.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::addr::Ipv4Net;
use crate::cmd::{CmdError, Runner};
use crate::ids::NodeId;
use crate::policy::IfacePattern;

/// Default fleet-wide mesh MTU: covers a 1460-byte cloud underlay with an IPv6 outer header.
pub const DEFAULT_FLEET_MTU: u16 = 1380;
/// Keepalive on every path that crosses a NAT; the mapping lapsed after ~120 s idle without it.
pub const NAT_KEEPALIVE_SECS: u16 = 25;
/// WireGuard listen ports otterd may use (two rotation generations and spares).
pub const PORT_RANGE: (u16, u16) = (51820, 51899);

/// Kind of underlay address a candidate endpoint is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PathKind {
    /// A private network both nodes are on.
    Private,
    /// An operator-provided VPN or overlay.
    ByoVpn,
    /// The public address.
    Public,
}

/// How a node's public side behaves, declared at enrollment (never discovered silently).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Nat {
    /// Reachable directly.
    #[default]
    None,
    /// Behind a NAT with an operator-declared inbound port-forward to the WireGuard port.
    Forwarded {
        /// The mapped public address peers can initiate to.
        mapped: SocketAddr,
    },
    /// Behind a port-preserving (cone) NAT without a forward; a direct NAT-to-NAT tunnel needs
    /// the predicted mapping declared.
    Cone {
        /// Declared predicted mapping, if any.
        predicted: Option<SocketAddr>,
    },
    /// Behind a randomizing (symmetric) NAT: never reachable inbound.
    Symmetric,
}

/// A node's underlay facts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Underlay {
    /// Candidate addresses by kind, in the node's own view (listen port included).
    pub candidates: BTreeMap<PathKind, SocketAddr>,
    /// Private network identity per private candidate, so two nodes only try private paths on
    /// the same network.
    #[serde(default)]
    pub private_network: Option<String>,
    /// NAT behaviour of the public side.
    #[serde(default)]
    pub nat: Nat,
    /// Smallest MTU on the node's underlay links, per path kind.
    pub mtu: BTreeMap<PathKind, u16>,
    /// Overhead of tunnels nested under WireGuard (a BYO VPN), per path kind.
    #[serde(default)]
    pub nested_overhead: BTreeMap<PathKind, u16>,
}

/// The tunnel MTU a path allows: smallest underlay MTU minus 60 (IPv4 outer) or 80 (IPv6 outer)
/// minus nested tunnel overhead. 1450 private → 1390; 1500 with a possible IPv6 endpoint → 1420.
#[must_use]
pub fn tunnel_mtu(underlay_mtu: u16, endpoint: IpAddr, nested_overhead: u16) -> u16 {
    let outer = if endpoint.is_ipv4() { 60 } else { 80 };
    underlay_mtu
        .saturating_sub(outer)
        .saturating_sub(nested_overhead)
}

/// Why a pair has no usable path, phrased as the requirement shown to the operator.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PathError {
    /// Neither side can be reached inbound.
    #[error(
        "{a} and {b} are both behind NAT and neither can be reached inbound: add a port-forward on one side, declare matching cone-NAT mappings on both, or route through a public hub node or a BYO underlay"
    )]
    BothNated {
        /// One node.
        a: NodeId,
        /// The other.
        b: NodeId,
    },
    /// No candidate passed the handshake test.
    #[error("no tested path between {a} and {b}: every candidate failed the handshake test")]
    NoTestedPath {
        /// One node.
        a: NodeId,
        /// The other.
        b: NodeId,
    },
}

/// The chosen path for one ordered pair (`from` configures `to` as a peer).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairPath {
    /// Endpoint `from` sends to; `None` when `from` cannot initiate and waits for `to`.
    pub endpoint: Option<SocketAddr>,
    /// Path kind.
    pub kind: PathKind,
    /// Persistent keepalive, seconds (0 = off).
    pub keepalive: u16,
    /// Tunnel MTU this path allows.
    pub mtu: u16,
}

/// Results of authenticated handshake tests: which (from, to, kind) completed.
pub type HandshakeResults = BTreeSet<(NodeId, NodeId, PathKind)>;

fn inbound(u: &Underlay, kind: PathKind) -> Option<SocketAddr> {
    let addr = *u.candidates.get(&kind)?;
    if kind != PathKind::Public {
        return Some(addr);
    }
    match u.nat {
        Nat::None => Some(addr),
        Nat::Forwarded { mapped } => Some(mapped),
        Nat::Cone { predicted } => predicted,
        Nat::Symmetric => None,
    }
}

const fn nated(u: &Underlay) -> bool {
    !matches!(u.nat, Nat::None)
}

/// Picks the path for the pair (a, b) and the per-direction peer config: private if both are
/// on the same private network and it tested both ways, then BYO VPN, then public. A side that
/// cannot be reached inbound gets no endpoint (the other side initiates, keepalive 25 s).
///
/// # Errors
/// [`PathError`] with the operator-facing requirement.
pub fn select_pair(
    a: (&NodeId, &Underlay),
    b: (&NodeId, &Underlay),
    tested: &HandshakeResults,
) -> Result<(PairPath, PairPath), PathError> {
    let ((an, au), (bn, bu)) = (a, b);
    let ok = |kind| {
        tested.contains(&(an.clone(), bn.clone(), kind))
            && tested.contains(&(bn.clone(), an.clone(), kind))
    };
    for kind in [PathKind::Private, PathKind::ByoVpn, PathKind::Public] {
        if kind == PathKind::Private
            && (au.private_network.is_none() || au.private_network != bu.private_network)
        {
            continue;
        }
        let (a_in, b_in) = (inbound(au, kind), inbound(bu, kind));
        if a_in.is_none() && b_in.is_none() {
            if kind == PathKind::Public
                && au.candidates.contains_key(&kind)
                && bu.candidates.contains_key(&kind)
            {
                return Err(PathError::BothNated {
                    a: an.clone(),
                    b: bn.clone(),
                });
            }
            continue;
        }
        if !ok(kind) {
            continue;
        }
        let crosses_nat = kind == PathKind::Public && (nated(au) || nated(bu));
        let keepalive = if crosses_nat { NAT_KEEPALIVE_SECS } else { 0 };
        let mtu_of = |u: &Underlay, ep: Option<SocketAddr>| {
            let underlay = u.mtu.get(&kind).copied().unwrap_or(1500);
            let ip = ep.map_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED), |e| e.ip());
            tunnel_mtu(
                underlay,
                ip,
                u.nested_overhead.get(&kind).copied().unwrap_or(0),
            )
        };
        let mtu = mtu_of(au, b_in).min(mtu_of(bu, a_in));
        return Ok((
            PairPath {
                endpoint: b_in,
                kind,
                keepalive,
                mtu,
            },
            PairPath {
                endpoint: a_in,
                kind,
                keepalive,
                mtu,
            },
        ));
    }
    Err(PathError::NoTestedPath {
        a: an.clone(),
        b: bn.clone(),
    })
}

/// Whether a node may carry cross-node traffic at the fleet MTU.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MtuEligibility {
    /// Every path allows at least the fleet MTU.
    Eligible,
    /// A path is narrower: lowering the fleet value is an explicit bridge-recreation step.
    Blocked {
        /// Smallest tunnel MTU over the node's paths.
        smallest: u16,
        /// The fleet value.
        fleet: u16,
    },
}

/// Applies the fleet MTU rule to one node's selected paths.
#[must_use]
pub fn mtu_eligibility(paths: &[PairPath], fleet_mtu: u16) -> MtuEligibility {
    match paths.iter().map(|p| p.mtu).min() {
        Some(smallest) if smallest < fleet_mtu => MtuEligibility::Blocked {
            smallest,
            fleet: fleet_mtu,
        },
        _ => MtuEligibility::Eligible,
    }
}

/// One peer on a mesh interface.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Peer {
    /// Node.
    pub node: NodeId,
    /// WireGuard public key (base64).
    pub public_key: String,
    /// Source prefixes this peer may use: its node slice and its mesh address(es).
    pub allowed_ips: Vec<Ipv4Net>,
    /// Prefixes routed to this peer through the interface (usually its slice).
    pub routes: Vec<Ipv4Net>,
    /// The peer's stable control address: allowed on every generation's interface and routed,
    /// like the slice, through whichever interface owns routes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stable: Option<Ipv4Addr>,
    /// Path.
    pub path: PairPath,
}

/// This node's stable control address and the dummy device that holds it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StableAddress {
    /// The /32 from the mesh range's stable /24.
    pub address: Ipv4Addr,
    /// Dummy device holding it, so it outlives any generation's interface.
    pub device: String,
}

/// A mesh interface's full desired state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshInterface {
    /// Interface name; must match the policy's mesh pattern.
    pub name: String,
    /// This node's mesh address, with the generation's prefix length.
    pub address: Ipv4Addr,
    /// Prefix length of the mesh generation (24).
    pub address_len: u8,
    /// Private key file (mode 0600).
    pub private_key_file: PathBuf,
    /// Listen port.
    pub listen_port: u16,
    /// Interface MTU (the fleet MTU).
    pub mtu: u16,
    /// Peers.
    pub peers: Vec<Peer>,
    /// Whether routes to peer slices point at this interface (false while a rotation stages a
    /// second interface: routes move only at the switch).
    pub owns_routes: bool,
    /// This node's stable control address. Node-to-node control traffic (owner and peer
    /// challenges, path probes) uses it on both ends, so it follows the route switch and the old
    /// interface drains during a rotation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_stable: Option<StableAddress>,
}

/// A mesh interface that cannot be configured.
#[derive(Debug, thiserror::Error)]
pub enum MeshError {
    /// The name does not match the policy's mesh pattern, so the policy would not cover it.
    #[error("interface {name} does not match the mesh pattern {pattern}")]
    Name {
        /// The name.
        name: String,
        /// The pattern.
        pattern: String,
    },
    /// A public key is not 44 base64 characters.
    #[error("peer {0} has a malformed public key")]
    Key(NodeId),
    /// A command failed.
    #[error(transparent)]
    Cmd(#[from] CmdError),
}

fn key_ok(k: &str) -> bool {
    k.len() == 44
        && k.ends_with('=')
        && k.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'='))
}

impl MeshInterface {
    /// Validates the interface against the policy's mesh pattern and key syntax.
    ///
    /// # Errors
    /// [`MeshError::Name`] or [`MeshError::Key`].
    pub fn validate(&self, mesh: &IfacePattern) -> Result<(), MeshError> {
        if !mesh.matches(&self.name) || IfacePattern::new(self.name.clone()).is_err() {
            return Err(MeshError::Name {
                name: self.name.clone(),
                pattern: mesh.as_str().to_owned(),
            });
        }
        if let Some(p) = self.peers.iter().find(|p| !key_ok(&p.public_key)) {
            return Err(MeshError::Key(p.node.clone()));
        }
        Ok(())
    }

    /// `ip -batch` input bringing the link, address, MTU and routes to the desired state.
    #[must_use]
    pub fn render_ip_batch(&self, link_exists: bool) -> String {
        let mut o = String::new();
        if !link_exists {
            let _ = writeln!(o, "link add {} type wireguard", self.name);
        }
        let _ = writeln!(
            o,
            "address replace {}/{} dev {}",
            self.address, self.address_len, self.name
        );
        let _ = writeln!(o, "link set {} mtu {} up", self.name, self.mtu);
        if let Some(st) = &self.local_stable {
            let _ = writeln!(o, "address replace {}/32 dev {}", st.address, st.device);
            let _ = writeln!(o, "link set {} up", st.device);
        }
        if self.owns_routes {
            for p in &self.peers {
                for r in &p.routes {
                    let _ = writeln!(o, "route replace {r} dev {}", self.name);
                }
                if let Some(peer_stable) = p.stable {
                    // Source the local stable address so replies come back to it as well.
                    match &self.local_stable {
                        Some(st) => {
                            let _ = writeln!(
                                o,
                                "route replace {peer_stable}/32 dev {} src {}",
                                self.name, st.address
                            );
                        }
                        None => {
                            let _ = writeln!(o, "route replace {peer_stable}/32 dev {}", self.name);
                        }
                    }
                }
            }
        }
        o
    }

    /// `wg set` arguments for the interface and every peer.
    #[must_use]
    pub fn wg_set_args(&self) -> Vec<String> {
        let mut a = vec![
            "set".to_owned(),
            self.name.clone(),
            "private-key".to_owned(),
            self.private_key_file.to_string_lossy().into_owned(),
            "listen-port".to_owned(),
            self.listen_port.to_string(),
        ];
        for p in &self.peers {
            a.push("peer".to_owned());
            a.push(p.public_key.clone());
            a.push("allowed-ips".to_owned());
            a.push(
                p.allowed_ips
                    .iter()
                    .map(ToString::to_string)
                    .chain(p.stable.map(|s| format!("{s}/32")))
                    .collect::<Vec<_>>()
                    .join(","),
            );
            if let Some(ep) = p.path.endpoint {
                a.push("endpoint".to_owned());
                a.push(ep.to_string());
            }
            a.push("persistent-keepalive".to_owned());
            a.push(if p.path.keepalive == 0 {
                "off".to_owned()
            } else {
                p.path.keepalive.to_string()
            });
        }
        a
    }

    /// Applies the desired state: link, addresses, peers (removing peers that are no longer
    /// listed) and routes. Idempotent.
    ///
    /// # Errors
    /// [`MeshError::Cmd`].
    pub fn apply<R: Runner>(&self, runner: &R, mesh: &IfacePattern) -> Result<(), MeshError> {
        self.validate(mesh)?;
        let exists = runner
            .run(
                "ip",
                &["link", "show", "dev", &self.name],
                None,
                crate::cmd::DEFAULT_TIMEOUT,
            )?
            .success();
        if !exists {
            runner.ok(
                "ip",
                &["link", "add", &self.name, "type", "wireguard"],
                None,
            )?;
        }
        if let Some(st) = &self.local_stable {
            let has_device = runner
                .run(
                    "ip",
                    &["link", "show", "dev", &st.device],
                    None,
                    crate::cmd::DEFAULT_TIMEOUT,
                )?
                .success();
            if !has_device {
                runner.ok("ip", &["link", "add", &st.device, "type", "dummy"], None)?;
            }
        }
        let args = self.wg_set_args();
        let args: Vec<&str> = args.iter().map(String::as_str).collect();
        runner.ok("wg", &args, None)?;
        let have = runner
            .ok("wg", &["show", &self.name, "peers"], None)?
            .stdout;
        let want: BTreeSet<&str> = self.peers.iter().map(|p| p.public_key.as_str()).collect();
        for gone in have
            .lines()
            .map(str::trim)
            .filter(|k| !k.is_empty() && !want.contains(k))
        {
            runner.ok("wg", &["set", &self.name, "peer", gone, "remove"], None)?;
        }
        runner.ok("ip", &["-batch", "-"], Some(&self.render_ip_batch(true)))?;
        Ok(())
    }
}

/// Latest handshake age per peer public key, from `wg show <if> latest-handshakes` and the
/// current epoch second. `None` means never.
#[must_use]
pub fn parse_handshakes(text: &str, now_epoch: u64) -> BTreeMap<String, Option<u64>> {
    text.lines()
        .filter_map(|l| {
            let mut it = l.split_whitespace();
            let key = it.next()?.to_owned();
            let at: u64 = it.next()?.parse().ok()?;
            Some((key, (at != 0).then(|| now_epoch.saturating_sub(at))))
        })
        .collect()
}

/// Transfer counters per peer from `wg show <if> transfer`: (rx bytes, tx bytes).
#[must_use]
pub fn parse_transfer(text: &str) -> BTreeMap<String, (u64, u64)> {
    text.lines()
        .filter_map(|l| {
            let mut it = l.split_whitespace();
            let key = it.next()?.to_owned();
            Some((key, (it.next()?.parse().ok()?, it.next()?.parse().ok()?)))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cmd::fake::Fake;

    fn sa(s: &str) -> SocketAddr {
        s.parse().unwrap()
    }

    fn node(private: Option<&str>, public: &str, nat: Nat) -> Underlay {
        let mut c = BTreeMap::new();
        if let Some(p) = private {
            c.insert(PathKind::Private, sa(p));
        }
        c.insert(PathKind::Public, sa(public));
        Underlay {
            candidates: c,
            private_network: private.map(|_| "hel-net".to_owned()),
            nat,
            mtu: [(PathKind::Private, 1450), (PathKind::Public, 1500)].into(),
            nested_overhead: BTreeMap::new(),
        }
    }

    fn all_tested(a: &str, b: &str) -> HandshakeResults {
        let mut t = BTreeSet::new();
        for k in [PathKind::Private, PathKind::ByoVpn, PathKind::Public] {
            t.insert((NodeId::new(a).unwrap(), NodeId::new(b).unwrap(), k));
            t.insert((NodeId::new(b).unwrap(), NodeId::new(a).unwrap(), k));
        }
        t
    }

    #[test]
    fn mtu_rule_matches_the_measured_values() {
        assert_eq!(tunnel_mtu(1450, "10.0.0.1".parse().unwrap(), 0), 1390);
        assert_eq!(tunnel_mtu(1500, "2001:db8::1".parse().unwrap(), 0), 1420);
        assert_eq!(
            tunnel_mtu(1460, "2001:db8::1".parse().unwrap(), 0),
            DEFAULT_FLEET_MTU
        );
    }

    #[test]
    fn private_path_wins_when_tested_both_ways() {
        let (a, b) = (NodeId::new("w1").unwrap(), NodeId::new("w2").unwrap());
        let ua = node(Some("10.42.0.11:51820"), "198.51.100.1:51820", Nat::None);
        let ub = node(Some("10.42.0.12:51820"), "198.51.100.2:51820", Nat::None);
        let (ab, ba) = select_pair((&a, &ua), (&b, &ub), &all_tested("w1", "w2")).unwrap();
        assert_eq!(
            (ab.kind, ab.endpoint, ab.keepalive, ab.mtu),
            (PathKind::Private, Some(sa("10.42.0.12:51820")), 0, 1390)
        );
        assert_eq!(ba.endpoint, Some(sa("10.42.0.11:51820")));
        let mut one_way = all_tested("w1", "w2");
        one_way.remove(&(b.clone(), a.clone(), PathKind::Private));
        let (ab, _) = select_pair((&a, &ua), (&b, &ub), &one_way).unwrap();
        assert_eq!(
            ab.kind,
            PathKind::Public,
            "a one-direction handshake is not evidence"
        );
    }

    #[test]
    fn natted_node_initiates_with_keepalive_and_the_public_peer_waits() {
        let (a, b) = (NodeId::new("nat").unwrap(), NodeId::new("pub").unwrap());
        let ua = node(None, "192.0.2.10:51820", Nat::Cone { predicted: None });
        let ub = node(None, "198.51.100.2:51820", Nat::None);
        let (ab, ba) = select_pair((&a, &ua), (&b, &ub), &all_tested("nat", "pub")).unwrap();
        assert_eq!(ab.endpoint, Some(sa("198.51.100.2:51820")));
        assert_eq!(ab.keepalive, NAT_KEEPALIVE_SECS);
        assert_eq!(
            ba.endpoint, None,
            "the public peer cannot initiate without a forward"
        );
    }

    #[test]
    fn two_unmapped_nats_get_the_operator_requirement() {
        let (a, b) = (NodeId::new("n1").unwrap(), NodeId::new("n2").unwrap());
        let ua = node(None, "192.0.2.10:51820", Nat::Symmetric);
        let ub = node(None, "192.0.2.20:51820", Nat::Cone { predicted: None });
        assert!(matches!(
            select_pair((&a, &ua), (&b, &ub), &all_tested("n1", "n2")),
            Err(PathError::BothNated { .. })
        ));
        let ub = node(
            None,
            "192.0.2.20:51820",
            Nat::Forwarded {
                mapped: sa("203.0.113.5:51820"),
            },
        );
        let (ab, _) = select_pair((&a, &ua), (&b, &ub), &all_tested("n1", "n2")).unwrap();
        assert_eq!(ab.endpoint, Some(sa("203.0.113.5:51820")));
    }

    #[test]
    fn narrower_node_is_blocked_at_the_fleet_mtu() {
        let p = |mtu| PairPath {
            endpoint: None,
            kind: PathKind::Public,
            keepalive: 0,
            mtu,
        };
        assert_eq!(
            mtu_eligibility(&[p(1420), p(1390)], DEFAULT_FLEET_MTU),
            MtuEligibility::Eligible
        );
        assert_eq!(
            mtu_eligibility(&[p(1360)], DEFAULT_FLEET_MTU),
            MtuEligibility::Blocked {
                smallest: 1360,
                fleet: 1380
            }
        );
    }

    fn iface() -> MeshInterface {
        MeshInterface {
            name: "otw0".into(),
            address: Ipv4Addr::new(172, 30, 224, 1),
            address_len: 24,
            private_key_file: "/var/lib/otterd/mesh/a.key".into(),
            listen_port: 51820,
            mtu: 1380,
            peers: vec![Peer {
                node: NodeId::new("w2").unwrap(),
                public_key: "x".repeat(43) + "=",
                allowed_ips: vec![
                    "172.24.32.0/19".parse().unwrap(),
                    "172.30.224.2/32".parse().unwrap(),
                ],
                routes: vec!["172.24.32.0/19".parse().unwrap()],
                stable: Some(Ipv4Addr::new(172, 30, 225, 2)),
                path: PairPath {
                    endpoint: Some(sa("10.42.0.12:51820")),
                    kind: PathKind::Private,
                    keepalive: 25,
                    mtu: 1390,
                },
            }],
            owns_routes: true,
            local_stable: Some(StableAddress {
                address: Ipv4Addr::new(172, 30, 225, 1),
                device: "otm0".into(),
            }),
        }
    }

    #[test]
    fn interface_name_must_be_covered_by_the_policy() {
        let i = MeshInterface {
            name: "wg0".into(),
            ..iface()
        };
        assert!(matches!(
            i.validate(&IfacePattern::new("otw*").unwrap()),
            Err(MeshError::Name { .. })
        ));
    }

    #[test]
    fn apply_sets_peers_removes_strangers_and_routes() {
        let fake = Fake::new()
            .on("ip link show", 1, "")
            .on("wg show otw0 peers", 0, "STALEKEY=\n");
        iface()
            .apply(&fake, &IfacePattern::new("otw*").unwrap())
            .unwrap();
        let l = fake.lines();
        assert!(l.iter().any(|x| x == "ip link add otw0 type wireguard"));
        assert!(l.iter().any(|x| x == "ip link add otm0 type dummy"));
        assert!(l.iter().any(|x| x.contains("allowed-ips 172.24.32.0/19,172.30.224.2/32,172.30.225.2/32 endpoint 10.42.0.12:51820 persistent-keepalive 25")));
        assert!(l.iter().any(|x| x == "wg set otw0 peer STALEKEY= remove"));
        assert!(
            l.iter()
                .any(|x| x.contains("route replace 172.24.32.0/19 dev otw0"))
        );
        assert!(
            l.iter()
                .any(|x| x.contains("route replace 172.30.225.2/32 dev otw0 src 172.30.225.1"))
        );
        let staged = MeshInterface {
            owns_routes: false,
            ..iface()
        };
        let batch = staged.render_ip_batch(true);
        assert!(
            !batch.contains("route"),
            "a staged interface takes no routes, stable ones included"
        );
        assert!(batch.contains("address replace 172.30.225.1/32 dev otm0"));
    }

    #[test]
    fn handshake_and_transfer_parse() {
        let h = parse_handshakes("K1= 1000\nK2= 0\n", 1010);
        assert_eq!(h["K1="], Some(10));
        assert_eq!(h["K2="], None);
        assert_eq!(parse_transfer("K1= 5 7\n")["K1="], (5, 7));
    }
}
