//! The workload network on one node: each environment's scope network, its
//! resolver, and the names and stable addresses (VIPs) of what runs here.
//!
//! The control plane allocates every address and sends it on the grant
//! (`SlotGrant.network`). The node checks the values against the address
//! layout and applies them:
//!
//! - one Docker bridge network per scope, `otd-<scope>` on the Linux bridge
//!   `otb-<8 hex of sha256(scope)>`, created once and never reused when an
//!   existing network of that name disagrees;
//! - the container on it, with its address, the environment's resolver as
//!   its only DNS server and the zone as its search domain. Aliases are
//!   names in the resolver's view, never Engine aliases.
//!
//! After every change, and on every reconcile pass, [`NodeNet::sync`] derives
//! the rest from the journal and the endpoint book:
//!
//! - the zone file `otterd-dns` serves, one view per resolver address;
//! - each resolver address as a /32 on the dummy link `otd-dns0`, and the
//!   `otterd-dns` unit listening on them;
//! - the VIP receiver: local serving sets installed in
//!   [`otterd_net::vip::Receiver`], persisted before its table is loaded, with
//!   this node as the fresh owner of its own attempts, plus the VIP hairpin
//!   for backends on the client's own bridge.
//!
//! Only local owners feed the views here. Serving sets of services on other
//! nodes add to the same [`ZoneBuilder`] and [`Forwarder`]; they need owner
//! freshness proven by challenge, which local attempts do not.
//!
//! The firewall policy (scope pairs, the resolver destination check) is not
//! applied here. Until it is, scope bridges stay in the Engine's default
//! `nat` gateway mode, whose own filter keeps other bridges away from
//! unpublished ports, and the hairpin NAT table is loaded with the VIP table.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use otterd_dns::zone::{Record, RrBackend, View, Zone};
use otterd_engine::DockerClient;
use otterd_journal::NodeState;
use otterd_net::Ipv4Net;
use otterd_net::cmd::{DEFAULT_TIMEOUT, Runner};
use otterd_net::firewall::write_atomic;
use otterd_net::ipam::{self, LARGEST_SCOPE_LEN, UNIT_LEN};
use otterd_net::policy::{Egress, Interfaces, LocalScope, NodePolicy, Proto};
use otterd_net::vip::{self, PortMap, Receiver, VipBinding, VipView};
use otterd_proto::U53;
use otterd_proto::discovery::{
    ELIGIBILITY_TTL_MS, Endpoint, EndpointPort, OwnerSnapshot, ServingAttempt, ServingSet,
    Withdrawal,
};
use otterd_proto::ids::{
    AttemptId, GrantId, InstallId, NodeId, ScopeId, Sha256Hex, SlotRef, VipId,
};
use otterd_proto::lifecycle::GrantNetwork;
use otterd_proto::spec::{PortProtocol, ServiceSpec};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::lifecycle::NodeError;

const LABEL_MANAGED: &str = "dev.otterdeploy.managed";
const LABEL_CLASS: &str = "dev.otterdeploy.class";
const LABEL_SCOPE: &str = "dev.otterdeploy.scope";
const OPT_BRIDGE: &str = "com.docker.network.bridge.name";
const OPT_MTU: &str = "com.docker.network.driver.mtu";
/// The workload MTU, leaving room for the mesh encapsulation.
pub const MTU: &str = "1400";
/// The dummy link that carries every resolver address as a /32.
pub const DNS_LINK: &str = "otd-dns0";
/// Names under this suffix belong to otterd: another environment's name gets
/// NXDOMAIN, never a forward upstream.
const MANAGED_SUFFIX: &str = "otd.internal";
/// Rewrite leased state (dnsrr expiry, kernel alive sets) after a third of
/// its lease, so a pass or two can fail without anything expiring.
const REFRESH_MS: u64 = ELIGIBILITY_TTL_MS / 3;

/// Where the node network keeps its state and runs its responder.
#[derive(Debug, Clone)]
pub struct NetConfig {
    /// Endpoint book and VIP receiver state.
    pub state_dir: PathBuf,
    /// The zone `otterd-dns` serves.
    pub zone_file: PathBuf,
    /// The `otterd-dns` binary.
    pub dns_binary: PathBuf,
    /// systemd unit directory.
    pub unit_dir: PathBuf,
    /// The responder's unit name.
    pub dns_unit: String,
}

impl Default for NetConfig {
    fn default() -> Self {
        Self {
            state_dir: PathBuf::from("/var/lib/otterd/net"),
            zone_file: PathBuf::from("/var/lib/otterd/dns/zone.json"),
            dns_binary: PathBuf::from("/usr/lib/otterd/otterd-dns"),
            unit_dir: PathBuf::from("/etc/systemd/system"),
            dns_unit: "otterd-dns.service".into(),
        }
    }
}

// ------------------------------------------------------------------ place

/// A grant's place on the node network, checked against the address layout.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Place {
    pub scope: ScopeId,
    pub subnet: Ipv4Net,
    pub address: Ipv4Addr,
    pub resolver: Ipv4Addr,
    /// Lowercase, without the trailing dot.
    pub zone: String,
    pub vip: Option<(VipId, Ipv4Addr)>,
}

fn ipv4(raw: &str, what: &str) -> Result<Ipv4Addr, String> {
    raw.parse()
        .map_err(|_| format!("{what} {raw:?} is not an IPv4 address"))
}

/// A lowercase DNS name: labels of `a-z`, `0-9` and inner `-`.
pub fn check_dns_name(name: &str) -> Result<(), String> {
    let ok = !name.is_empty()
        && name.len() <= 253
        && name.split('.').all(|l| {
            !l.is_empty()
                && l.len() <= 63
                && !l.starts_with('-')
                && !l.ends_with('-')
                && l.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        });
    if ok {
        Ok(())
    } else {
        Err(format!("{name:?} is not a lowercase DNS name"))
    }
}

impl Place {
    /// Check a grant's network values. Every refusal names the bad value.
    pub fn check(n: &GrantNetwork) -> Result<Self, String> {
        let layout = ipam::Layout::default();
        let scope = n.scope_id.clone();
        if scope.as_str().len() > 60
            || !scope
                .as_str()
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
        {
            return Err(format!("scope id {scope} cannot name a Docker network"));
        }
        let subnet: Ipv4Net = n
            .subnet
            .parse()
            .map_err(|e| format!("subnet {:?}: {e}", n.subnet))?;
        if !(LARGEST_SCOPE_LEN..=UNIT_LEN).contains(&subnet.prefix_len()) {
            return Err(format!(
                "subnet {subnet} must be /{LARGEST_SCOPE_LEN} to /{UNIT_LEN}"
            ));
        }
        if !layout.supernet.covers(&subnet)
            || subnet.overlaps(&layout.vip)
            || subnet.overlaps(&layout.system)
        {
            return Err(format!(
                "subnet {subnet} is outside the workload range {}",
                layout.supernet
            ));
        }
        let place = Self {
            scope,
            subnet,
            address: ipv4(&n.address, "address")?,
            resolver: ipv4(&n.resolver, "resolver")?,
            zone: n.zone.clone(),
            vip: match &n.vip {
                Some(v) => Some((v.vip_id.clone(), ipv4(&v.address, "vip")?)),
                None => None,
            },
        };
        let a = place.address;
        if !subnet.contains(a) || a == subnet.addr() || a == place.gateway() || a == subnet.last() {
            return Err(format!(
                "address {a} is not a usable host of {subnet} (gateway {})",
                place.gateway()
            ));
        }
        if !layout.dns.contains(place.resolver) {
            return Err(format!(
                "resolver {} is outside the resolver range {}",
                place.resolver, layout.dns
            ));
        }
        if let Some((_, v)) = &place.vip
            && !layout.vip.contains(*v)
        {
            return Err(format!("vip {v} is outside the VIP range {}", layout.vip));
        }
        check_dns_name(&place.zone).map_err(|e| format!("zone: {e}"))?;
        Ok(place)
    }

    /// The first host address of the subnet.
    pub fn gateway(&self) -> Ipv4Addr {
        self.subnet.host(1).unwrap_or(self.subnet.addr())
    }

    pub fn network(&self) -> String {
        format!("otd-{}", self.scope)
    }

    /// `otb-` and 8 hex characters: 12, inside the kernel's 15.
    pub fn bridge(&self) -> String {
        let h = Sha256::digest(self.scope.as_str().as_bytes());
        format!("otb-{}", hex::encode(h.get(..4).unwrap_or_default()))
    }

    /// Everything fixed when the container was created: all but the VIP.
    pub fn same_attachment(&self, other: &Self) -> bool {
        Self {
            vip: None,
            ..self.clone()
        } == Self {
            vip: None,
            ..other.clone()
        }
    }

    /// `POST /networks/create` body.
    pub fn network_body(&self) -> Value {
        json!({
            "Name": self.network(),
            "Driver": "bridge",
            "IPAM": {"Config": [{"Subnet": self.subnet.to_string(), "Gateway": self.gateway().to_string()}]},
            "Options": {OPT_BRIDGE: self.bridge(), OPT_MTU: MTU},
            "Labels": {LABEL_MANAGED: "1", LABEL_CLASS: "scope", LABEL_SCOPE: self.scope.as_str()},
        })
    }

    /// An existing network of this name is used only when it is otterd's
    /// network for this scope, with this subnet and bridge.
    pub fn check_existing(&self, v: &Value) -> Result<(), String> {
        let name = self.network();
        let labels = v.get("Labels");
        for (k, want) in [
            (LABEL_MANAGED, "1"),
            (LABEL_CLASS, "scope"),
            (LABEL_SCOPE, self.scope.as_str()),
        ] {
            if labels.and_then(|l| l.get(k)).and_then(Value::as_str) != Some(want) {
                return Err(format!(
                    "network {name} exists without label {k}={want}; refusing to reuse it"
                ));
            }
        }
        let config = v.pointer("/IPAM/Config").and_then(Value::as_array);
        let subnets: Vec<&str> = config
            .into_iter()
            .flatten()
            .filter_map(|e| e.get("Subnet").and_then(Value::as_str))
            .collect();
        if subnets != [self.subnet.to_string()] {
            return Err(format!(
                "network {name} has subnets {subnets:?}, the grant says {}",
                self.subnet
            ));
        }
        let bridge = v.get("Options").and_then(|o| o.get(OPT_BRIDGE));
        let bridge = bridge.and_then(Value::as_str);
        if bridge != Some(self.bridge().as_str()) {
            return Err(format!(
                "network {name} uses bridge {bridge:?}, expected {}",
                self.bridge()
            ));
        }
        Ok(())
    }

    /// Put a create body on this network: address, resolver and search
    /// domain. No Engine aliases: every name, short or qualified, resolves
    /// through the environment's resolver, so it means the same on every
    /// node and always reaches the VIP.
    pub fn attach(&self, body: &mut Value) {
        let net = self.network();
        let Some(obj) = body.as_object_mut() else {
            return;
        };
        if let Some(host) = obj.get_mut("HostConfig").and_then(Value::as_object_mut) {
            host.insert("NetworkMode".into(), json!(net));
            host.insert("Dns".into(), json!([self.resolver.to_string()]));
            host.insert("DnsSearch".into(), json!([self.zone]));
        }
        obj.insert(
            "NetworkingConfig".into(),
            json!({"EndpointsConfig": {net: {
                "IPAMConfig": {"IPv4Address": self.address.to_string()},
            }}}),
        );
    }
}

/// Create the scope network unless otterd's network for the scope exists.
pub async fn ensure_scope_network(docker: &DockerClient, place: &Place) -> Result<(), NodeError> {
    let name = place.network();
    for _ in 0..2 {
        let r = docker.get(&format!("/networks/{name}")).await?;
        if r.status.is_success() {
            let v: Value = r
                .json()
                .map_err(|e| NodeError::Internal(format!("network {name}: {e}")))?;
            return place.check_existing(&v).map_err(NodeError::Refused);
        }
        if r.status != http::StatusCode::NOT_FOUND {
            return Err(NodeError::Internal(format!(
                "inspect network {name}: {} {}",
                r.status,
                r.message()
            )));
        }
        let body = place.network_body().to_string();
        let c = docker
            .send(http::Method::POST, "/networks/create", Some(body.into()))
            .await?;
        if c.status.is_success() {
            tracing::info!(network = %name, subnet = %place.subnet, bridge = %place.bridge(), "scope network created");
            return Ok(());
        }
        // A concurrent apply for the same scope won the create: look again.
        if c.status != http::StatusCode::CONFLICT {
            return Err(NodeError::Refused(format!(
                "create network {name}: {} {}",
                c.status,
                c.message()
            )));
        }
    }
    Err(NodeError::Internal(format!(
        "network {name} neither exists nor can be created"
    )))
}

// ------------------------------------------------------------------ endpoints

/// What a grant's spec says about its endpoint, kept because the journal
/// keeps only the spec digest.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub aliases: Vec<String>,
    /// VIP ports; the backend port is the same port.
    pub ports: Vec<PortMap>,
}

impl Entry {
    pub fn of(spec: &ServiceSpec) -> Result<Self, String> {
        for a in &spec.endpoint.aliases {
            check_dns_name(a).map_err(|e| format!("alias: {e}"))?;
        }
        let ports: BTreeSet<PortMap> = spec
            .endpoint
            .ports
            .iter()
            .map(|p| PortMap {
                proto: match p.protocol {
                    PortProtocol::Tcp => Proto::Tcp,
                    PortProtocol::Udp => Proto::Udp,
                },
                port: p.target_port,
                target: p.target_port,
            })
            .collect();
        Ok(Self {
            aliases: spec.endpoint.aliases.clone(),
            ports: ports.into_iter().collect(),
        })
    }
}

/// An unreleased grant with a place on this node.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Local {
    pub grant: GrantId,
    pub slot: SlotRef,
    pub generation: U53,
    pub attempt: AttemptId,
    pub place: Place,
    pub entry: Entry,
    /// Not revoked: it serves new flows. A held attempt stays live.
    pub live: bool,
}

/// Every unreleased grant with a network, from the journal.
pub fn locals(state: &NodeState, book: &BTreeMap<GrantId, Entry>) -> Vec<Local> {
    state
        .grants
        .values()
        .filter(|g| !g.is_released())
        .filter_map(|g| {
            let place = Place::check(g.grant.network.as_ref()?).ok()?;
            Some(Local {
                grant: g.grant.grant_id.clone(),
                slot: g.grant.slot.clone(),
                generation: g.grant.generation,
                attempt: g.attempts.last()?.clone(),
                place,
                entry: book.get(&g.grant.grant_id).cloned().unwrap_or_default(),
                live: g.revoked.is_none(),
            })
        })
        .collect()
}

// ------------------------------------------------------------------ zone

/// Builds the responder's zone. Local grants are one source; serving sets
/// of remote owners add names to the same views.
#[derive(Debug, Default)]
pub struct ZoneBuilder {
    views: BTreeMap<Ipv4Addr, View>,
    managed: BTreeSet<String>,
}

impl ZoneBuilder {
    /// The view for a resolver address, answering for `zone`.
    pub fn view(&mut self, resolver: Ipv4Addr, zone: &str) -> &mut View {
        if zone == MANAGED_SUFFIX || zone.ends_with(&format!(".{MANAGED_SUFFIX}")) {
            self.managed.insert(format!("{MANAGED_SUFFIX}."));
        }
        let view = self.views.entry(resolver).or_default();
        let apex = format!("{zone}.");
        if !view.zones.contains(&apex) {
            view.zones.push(apex);
            view.zones.sort();
        }
        view
    }

    /// Add a name; a VIP wins over round robin, round-robin backends merge.
    pub fn name(&mut self, resolver: Ipv4Addr, zone: &str, fqdn: String, record: Record) {
        let names = &mut self.view(resolver, zone).names;
        let merged = match (names.remove(&fqdn), record) {
            (Some(v @ Record::Vip { .. }), _) | (_, v @ Record::Vip { .. }) => v,
            (Some(Record::Rr { backends: mut a }), Record::Rr { backends: b }) => {
                for x in b {
                    match a.iter_mut().find(|y| y.addr == x.addr) {
                        Some(y) => y.expires_unix_ms = y.expires_unix_ms.max(x.expires_unix_ms),
                        None => a.push(x),
                    }
                }
                a.sort_by_key(|b| b.addr);
                Record::Rr { backends: a }
            }
            (None, rr) => rr,
        };
        names.insert(fqdn, merged);
    }

    /// A local grant: each alias under its zone, the VIP or this attempt.
    /// The owner is this node, so a dnsrr backend's freshness runs from now.
    pub fn local(&mut self, l: &Local, now_unix_ms: u64) {
        let p = &l.place;
        self.view(p.resolver, &p.zone);
        for alias in &l.entry.aliases {
            let record = match &p.vip {
                Some((_, addr)) => Record::Vip { addr: *addr },
                None => Record::Rr {
                    backends: if l.live {
                        vec![RrBackend {
                            addr: p.address,
                            expires_unix_ms: now_unix_ms.saturating_add(ELIGIBILITY_TTL_MS),
                        }]
                    } else {
                        Vec::new()
                    },
                },
            };
            self.name(p.resolver, &p.zone, format!("{alias}.{}.", p.zone), record);
        }
    }

    pub fn build(self, serial: u32) -> Zone {
        Zone {
            serial,
            managed: self.managed.into_iter().collect(),
            views: self.views,
        }
    }
}

/// The zone without what changes on its own (serial, freshness expiry).
fn zone_shape(z: &Zone) -> Zone {
    let mut s = z.clone();
    s.serial = 0;
    for v in s.views.values_mut() {
        for r in v.names.values_mut() {
            if let Record::Rr { backends } = r {
                for b in backends {
                    b.expires_unix_ms = 0;
                }
            }
        }
    }
    s
}

fn has_leases(z: &Zone) -> bool {
    z.views.values().any(|v| {
        v.names
            .values()
            .any(|r| matches!(r, Record::Rr { backends } if !backends.is_empty()))
    })
}

// ------------------------------------------------------------------ VIPs

/// What this node serves under one VIP.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub scope: ScopeId,
    pub binding: VipBinding,
    pub attempts: BTreeMap<AttemptId, Backend>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Backend {
    pub grant: GrantId,
    pub slot: SlotRef,
    pub generation: U53,
    pub address: Ipv4Addr,
}

/// Local VIP groups: live attempts of every grant that names the VIP.
pub fn groups(locals: &[Local]) -> BTreeMap<VipId, Group> {
    let mut out: BTreeMap<VipId, Group> = BTreeMap::new();
    for l in locals {
        let Some((id, vip)) = &l.place.vip else {
            continue;
        };
        let g = out.entry(id.clone()).or_insert_with(|| Group {
            scope: l.place.scope.clone(),
            binding: VipBinding {
                vip: *vip,
                ports: Vec::new(),
            },
            attempts: BTreeMap::new(),
        });
        let ports: BTreeSet<PortMap> = g
            .binding
            .ports
            .iter()
            .chain(&l.entry.ports)
            .copied()
            .collect();
        g.binding.ports = ports.into_iter().collect();
        if l.live {
            g.attempts.insert(
                l.attempt.clone(),
                Backend {
                    grant: l.grant.clone(),
                    slot: l.slot.clone(),
                    generation: l.generation,
                    address: l.place.address,
                },
            );
        }
    }
    out
}

/// Who local attempts are published under: this node, as journalled.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Owner {
    pub install_id: InstallId,
    pub node_id: NodeId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Installed {
    revision: u64,
    group: Group,
}

/// The VIP receiver fed from local admission, with what it last installed.
/// Times are this node's unix milliseconds. Persisted after every change,
/// before the table is loaded.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Forwarder {
    receiver: Receiver,
    installed: BTreeMap<VipId, Installed>,
    seq: u64,
}

fn endpoint_ports(ports: &[PortMap]) -> Vec<EndpointPort> {
    ports
        .iter()
        .map(|p| EndpointPort {
            protocol: match p.proto {
                Proto::Tcp => PortProtocol::Tcp,
                Proto::Udp => PortProtocol::Udp,
            },
            port: p.target,
        })
        .collect()
}

impl Forwarder {
    pub fn is_empty(&self) -> bool {
        self.installed.is_empty()
    }

    /// Install each VIP whose local backends changed as its next serving
    /// revision (a vanished attempt is withdrawn, which is terminal), publish
    /// the owner snapshot, and re-prove this node's own freshness. A VIP that
    /// loses its last local backend stays, refusing new flows fast.
    pub fn advance(
        &mut self,
        groups: &BTreeMap<VipId, Group>,
        who: &Owner,
        now_ms: u64,
    ) -> Result<bool, vip::Refused> {
        let owner = who.node_id.clone();
        let install = who.install_id.clone();
        let ids: BTreeSet<VipId> = groups
            .keys()
            .chain(self.installed.keys())
            .cloned()
            .collect();
        let mut changed = false;
        for id in ids {
            let prev = self.installed.get(&id);
            let want = match (groups.get(&id), prev) {
                (Some(g), _) => g.clone(),
                (None, Some(p)) => Group {
                    attempts: BTreeMap::new(),
                    ..p.group.clone()
                },
                (None, None) => continue,
            };
            if prev.is_some_and(|p| p.group == want) {
                continue;
            }
            let revision = prev.map_or(1, |p| p.revision.saturating_add(1));
            let rev = U53::new(revision).unwrap_or(U53::MAX);
            let set = ServingSet {
                install_id: install.clone(),
                authority_term: U53::ONE,
                scope_id: want.scope.clone(),
                vip_id: id.clone(),
                vip_address: want.binding.vip.to_string(),
                names: Vec::new(),
                ports: endpoint_ports(&want.binding.ports),
                serving_revision: rev,
                operation_epoch: U53::ONE,
                new_flow_attempts: want
                    .attempts
                    .iter()
                    .map(|(a, b)| ServingAttempt {
                        grant_id: b.grant.clone(),
                        attempt_id: a.clone(),
                        node_epoch: U53::ONE,
                        address: b.address.to_string(),
                        ports: endpoint_ports(&want.binding.ports),
                    })
                    .collect(),
                // The local attempt is gone or revoked: no drain to wait for.
                withdrawals: prev
                    .into_iter()
                    .flat_map(|p| p.group.attempts.keys())
                    .filter(|a| !want.attempts.contains_key(*a))
                    .map(|a| Withdrawal {
                        attempt_id: a.clone(),
                        withdrawal_revision: rev,
                        drain_budget_ms: U53::ZERO,
                    })
                    .collect(),
            };
            self.receiver.install(&set, want.binding.clone(), now_ms)?;
            self.installed.insert(
                id,
                Installed {
                    revision,
                    group: want,
                },
            );
            changed = true;
        }
        if changed {
            self.seq = self.seq.saturating_add(1);
            let endpoints: Vec<Endpoint> = self
                .installed
                .values()
                .flat_map(|i| {
                    i.group.attempts.iter().map(|(a, b)| Endpoint {
                        grant_id: b.grant.clone(),
                        slot: b.slot.clone(),
                        generation: b.generation,
                        attempt_id: a.clone(),
                        address: b.address.to_string(),
                        ports: endpoint_ports(&i.group.binding.ports),
                        readiness_revision: U53::ONE,
                        scope_id: i.group.scope.clone(),
                    })
                })
                .collect();
            let digest = Sha256Hex::digest(&serde_json::to_vec(&endpoints).unwrap_or_default());
            self.receiver.owner_snapshot(&OwnerSnapshot {
                node_id: owner.clone(),
                node_epoch: U53::ONE,
                publisher_incarnation: U53::ONE,
                seq: U53::new(self.seq).unwrap_or(U53::MAX),
                membership_epoch: U53::ONE,
                placement_revision: U53::ONE,
                full_set_digest: digest,
                endpoints,
            })?;
        }
        self.receiver.owner_fresh(&owner, now_ms);
        Ok(changed)
    }

    pub fn views(&self, now_ms: u64) -> Vec<VipView> {
        self.receiver.views(now_ms)
    }

    /// Withdrawn backends whose flows to forget: `(vip, backend)`, once each.
    pub fn take_drains(&mut self, now_ms: u64) -> Vec<(Ipv4Addr, Ipv4Addr)> {
        let due = self.receiver.drains_due(now_ms);
        for (a, _) in &due {
            self.receiver.drain_done(a);
        }
        due.into_iter()
            .filter_map(|(_, d)| Some((d.vip, d.addr?)))
            .collect()
    }
}

/// The receiver table plus the hairpin for local scopes: without
/// `br_netfilter` a same-bridge backend answers the client directly and the
/// reply bypasses conntrack, so DNAT'd flows inside one scope are masqueraded.
pub fn render_nft(views: &[VipView], scopes: &BTreeSet<Ipv4Net>) -> String {
    let layout = ipam::Layout::default();
    let nat = NodePolicy {
        interfaces: Interfaces::default(),
        workload: layout.supernet,
        host_mesh: layout.mesh,
        vip: layout.vip,
        pairs: BTreeSet::new(),
        host_reach: BTreeSet::new(),
        published: BTreeSet::new(),
        edge_ports: BTreeSet::new(),
        local_scopes: scopes
            .iter()
            .map(|n| LocalScope {
                network: *n,
                egress: Egress::Docker,
            })
            .collect(),
        dns: Vec::new(),
        no_snat_extra: Vec::new(),
    }
    .render_nat();
    let mut text = vip::render(views);
    text.push_str(&nat);
    text
}

// ------------------------------------------------------------------ host

/// The parts that touch the kernel and systemd, through a bounded runner.
#[derive(Clone)]
pub struct Host {
    runner: Arc<dyn Runner>,
}

impl fmt::Debug for Host {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Host")
    }
}

fn link_addrs(text: &str) -> BTreeSet<Ipv4Addr> {
    text.lines()
        .filter_map(|l| {
            let mut w = l.split_whitespace().skip_while(|w| *w != "inet").skip(1);
            w.next()?.split('/').next()?.parse().ok()
        })
        .collect()
}

impl Host {
    pub fn new(runner: Arc<dyn Runner>) -> Self {
        Self { runner }
    }

    fn ok(&self, program: &str, args: &[&str], stdin: Option<&str>) -> Result<String, String> {
        self.runner
            .ok(program, args, stdin)
            .map(|o| o.stdout)
            .map_err(|e| e.to_string())
    }

    fn succeeds(&self, program: &str, args: &[&str]) -> Result<bool, String> {
        self.runner
            .run(program, args, None, DEFAULT_TIMEOUT)
            .map(|o| o.success())
            .map_err(|e| e.to_string())
    }

    /// Exactly `want` as /32s on the dummy resolver link.
    pub fn resolvers(&self, want: &BTreeSet<Ipv4Addr>) -> Result<(), String> {
        if !self.succeeds("ip", &["link", "show", "dev", DNS_LINK])? {
            if want.is_empty() {
                return Ok(());
            }
            self.ok("ip", &["link", "add", DNS_LINK, "type", "dummy"], None)?;
        }
        self.ok("ip", &["link", "set", DNS_LINK, "up"], None)?;
        let have =
            link_addrs(&self.ok("ip", &["-o", "-4", "addr", "show", "dev", DNS_LINK], None)?);
        let add = want.difference(&have).map(|a| ("add", a));
        for (verb, a) in add.chain(have.difference(want).map(|a| ("del", a))) {
            let cidr = format!("{a}/32");
            self.ok("ip", &["addr", verb, &cidr, "dev", DNS_LINK], None)?;
        }
        Ok(())
    }

    /// Install, start or restart the responder unit; `None` stops and removes it.
    pub fn unit(&self, cfg: &NetConfig, text: Option<&str>) -> Result<(), String> {
        let path = cfg.unit_dir.join(&cfg.dns_unit);
        let name = cfg.dns_unit.as_str();
        let current = std::fs::read_to_string(&path).ok();
        match text {
            Some(t) if current.as_deref() != Some(t) => {
                write_atomic(&path, t).map_err(|e| e.to_string())?;
                self.ok("systemctl", &["daemon-reload"], None)?;
                self.ok("systemctl", &["enable", name], None)?;
                self.ok("systemctl", &["restart", name], None)?;
            }
            Some(_) => {
                if !self.succeeds("systemctl", &["is-active", "--quiet", name])? {
                    self.ok("systemctl", &["enable", "--now", name], None)?;
                }
            }
            None if current.is_some() => {
                self.ok("systemctl", &["disable", "--now", name], None)?;
                std::fs::remove_file(&path).map_err(|e| format!("{}: {e}", path.display()))?;
                self.ok("systemctl", &["daemon-reload"], None)?;
            }
            None => {}
        }
        Ok(())
    }

    /// Load an nftables generation in one transaction.
    pub fn nft(&self, text: &str) -> Result<(), String> {
        self.ok("nft", &["-f", "-"], Some(text)).map(drop)
    }

    /// Forget the flows a withdrawn backend still carries for its VIP.
    /// Best effort: the backend is stopped or no longer ours.
    pub fn forget(&self, vip: Ipv4Addr, backend: Ipv4Addr) {
        let (v, b) = (vip.to_string(), backend.to_string());
        let args = ["-D", "-f", "ipv4", "-d", &v, "--reply-src", &b];
        if let Err(e) = self.runner.run("conntrack", &args, None, DEFAULT_TIMEOUT) {
            tracing::debug!(%vip, %backend, error = %e, "conntrack withdrawal skipped");
        }
    }
}

// ------------------------------------------------------------------ the node network

#[derive(Debug, Default)]
struct Inner {
    book: BTreeMap<GrantId, Entry>,
    forwarder: Forwarder,
    serial: u32,
    zone_shape: Option<Zone>,
    zone_written_ms: u64,
    listeners: Option<BTreeSet<Ipv4Addr>>,
    nft_shape: Option<String>,
    nft_applied_ms: u64,
}

/// The node network: configuration, kernel access and derived state.
#[derive(Debug)]
pub struct NodeNet {
    cfg: NetConfig,
    host: Host,
    inner: Mutex<Inner>,
}

fn read_json<T: for<'de> Deserialize<'de> + Default>(path: &Path) -> Result<T, String> {
    match std::fs::read_to_string(path) {
        Ok(t) => serde_json::from_str(&t).map_err(|e| format!("{}: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

fn write_json<T: Serialize>(path: &Path, v: &T) -> Result<(), String> {
    let text = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
    write_atomic(path, &text).map_err(|e| e.to_string())
}

impl NodeNet {
    /// Open the persisted state. A receiver state that cannot be read is an
    /// error, not a fresh start: its withdrawals are terminal.
    pub fn open(cfg: NetConfig, runner: Arc<dyn Runner>, now_ms: u64) -> Result<Self, String> {
        let book = read_json(&cfg.state_dir.join("endpoints.json"))?;
        let mut forwarder: Forwarder = read_json(&cfg.state_dir.join("vip-receiver.json"))?;
        forwarder.receiver = forwarder.receiver.restarted(now_ms, false);
        let serial = read_json::<Zone>(&cfg.zone_file).map_or(0, |z| z.serial);
        Ok(Self {
            cfg,
            host: Host::new(runner),
            inner: Mutex::new(Inner {
                book,
                forwarder,
                serial,
                ..Inner::default()
            }),
        })
    }

    pub fn config(&self) -> &NetConfig {
        &self.cfg
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Inner>, String> {
        self.inner
            .lock()
            .map_err(|_| "node network state poisoned".to_owned())
    }

    /// Keep a grant's endpoint (aliases, ports) for the views.
    pub fn record(&self, grant: &GrantId, entry: Entry) -> Result<(), String> {
        let mut inner = self.lock()?;
        if inner.book.get(grant) != Some(&entry) {
            inner.book.insert(grant.clone(), entry);
            write_json(&self.cfg.state_dir.join("endpoints.json"), &inner.book)?;
        }
        Ok(())
    }

    /// Bring the zone, resolver addresses, responder unit and VIP table in
    /// line with the journal. Each part is tried; the first error is returned.
    pub fn sync(&self, state: &NodeState, now_ms: u64) -> Result<(), String> {
        let mut inner = self.lock()?;
        let before = inner.book.len();
        inner
            .book
            .retain(|g, _| state.grants.get(g).is_some_and(|s| !s.is_released()));
        if inner.book.len() != before {
            write_json(&self.cfg.state_dir.join("endpoints.json"), &inner.book)?;
        }
        let locals = locals(state, &inner.book);
        if locals.is_empty() && inner.forwarder.is_empty() && !self.cfg.zone_file.exists() {
            return Ok(());
        }
        let mut errors = Vec::new();
        if let Err(e) = self.sync_zone(&mut inner, &locals, now_ms) {
            errors.push(format!("zone: {e}"));
        }
        if let Err(e) = self.sync_responder(&mut inner, &locals) {
            errors.push(format!("resolver: {e}"));
        }
        let owner = state.identity.as_ref().map(|i| Owner {
            install_id: i.install_id.clone(),
            node_id: i.node_id.clone(),
        });
        if let Err(e) = self.sync_vips(&mut inner, &locals, owner.as_ref(), now_ms) {
            errors.push(format!("vip: {e}"));
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("; "))
        }
    }

    fn sync_zone(&self, inner: &mut Inner, locals: &[Local], now_ms: u64) -> Result<(), String> {
        let mut b = ZoneBuilder::default();
        for l in locals {
            b.local(l, now_ms);
        }
        let mut zone = b.build(0);
        let shape = zone_shape(&zone);
        let due = has_leases(&zone) && now_ms.saturating_sub(inner.zone_written_ms) >= REFRESH_MS;
        if inner.zone_shape.as_ref() == Some(&shape) && !due {
            return Ok(());
        }
        let secs = u32::try_from(now_ms / 1000).unwrap_or(u32::MAX);
        inner.serial = secs.max(inner.serial.saturating_add(1));
        zone.serial = inner.serial;
        write_json(&self.cfg.zone_file, &zone)?;
        inner.zone_shape = Some(shape);
        inner.zone_written_ms = now_ms;
        Ok(())
    }

    fn sync_responder(&self, inner: &mut Inner, locals: &[Local]) -> Result<(), String> {
        let want: BTreeSet<Ipv4Addr> = locals.iter().map(|l| l.place.resolver).collect();
        if inner.listeners.as_ref() == Some(&want) {
            return Ok(());
        }
        self.host.resolvers(&want)?;
        let listen: Vec<Ipv4Addr> = want.iter().copied().collect();
        let unit = (!listen.is_empty()).then(|| {
            otterd_dns::render_unit(
                &self.cfg.dns_binary.display().to_string(),
                &self.cfg.zone_file.display().to_string(),
                &listen,
            )
        });
        self.host.unit(&self.cfg, unit.as_deref())?;
        tracing::info!(listeners = ?listen, "resolver listeners in place");
        inner.listeners = Some(want);
        Ok(())
    }

    fn sync_vips(
        &self,
        inner: &mut Inner,
        locals: &[Local],
        owner: Option<&Owner>,
        now_ms: u64,
    ) -> Result<(), String> {
        let groups = groups(locals);
        if groups.is_empty() && inner.forwarder.is_empty() {
            return Ok(());
        }
        let owner = owner.ok_or("no node identity to publish attempts under")?;
        let changed = inner
            .forwarder
            .advance(&groups, owner, now_ms)
            .map_err(|e| e.to_string())?;
        let drains = inner.forwarder.take_drains(now_ms);
        if changed || !drains.is_empty() {
            write_json(
                &self.cfg.state_dir.join("vip-receiver.json"),
                &inner.forwarder,
            )?;
        }
        let views = inner.forwarder.views(now_ms);
        let scopes: BTreeSet<Ipv4Net> = locals.iter().map(|l| l.place.subnet).collect();
        let shape = {
            let mut v = views.clone();
            for b in v.iter_mut().flat_map(|v| v.backends.iter_mut()) {
                b.remaining = std::time::Duration::ZERO;
            }
            render_nft(&v, &scopes)
        };
        let leased = views.iter().any(|v| !v.backends.is_empty());
        let due = leased && now_ms.saturating_sub(inner.nft_applied_ms) >= REFRESH_MS;
        if inner.nft_shape.as_ref() != Some(&shape) || due {
            let text = render_nft(&views, &scopes);
            write_atomic(&self.cfg.state_dir.join("vip.nft"), &text).map_err(|e| e.to_string())?;
            self.host.nft(&text)?;
            inner.nft_shape = Some(shape);
            inner.nft_applied_ms = now_ms;
        }
        for (vip, backend) in drains {
            self.host.forget(vip, backend);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use otterd_net::cmd::{CmdError, Output};
    use otterd_proto::lifecycle::GrantVip;
    use std::time::Duration;

    const VIP: Ipv4Addr = Ipv4Addr::new(172, 31, 0, 10);
    const DB: Ipv4Addr = Ipv4Addr::new(172, 24, 0, 34);

    fn net(addr: &str, vip: Option<Ipv4Addr>) -> GrantNetwork {
        GrantNetwork {
            scope_id: "scope-a".parse().unwrap(),
            subnet: "172.24.0.32/27".into(),
            address: addr.into(),
            resolver: "172.30.228.1".into(),
            zone: "a.otd.internal".into(),
            vip: vip.map(|v| GrantVip {
                vip_id: "vip-db".parse().unwrap(),
                address: v.to_string(),
            }),
        }
    }

    #[test]
    fn a_place_is_checked_and_its_network_reused_only_when_it_matches() {
        let p = Place::check(&net("172.24.0.34", Some(VIP))).unwrap();
        assert_eq!(p.gateway(), Ipv4Addr::new(172, 24, 0, 33));
        assert_eq!(
            (p.network().as_str(), p.bridge().len()),
            ("otd-scope-a", 12)
        );
        let bad = |f: &dyn Fn(&mut GrantNetwork)| {
            let mut n = net("172.24.0.34", None);
            f(&mut n);
            Place::check(&n).unwrap_err()
        };
        for a in [
            "172.24.0.32",
            "172.24.0.33",
            "172.24.0.63",
            "172.24.0.70",
            "x",
        ] {
            assert!(bad(&|n| n.address = a.into()).contains(a), "{a}");
        }
        assert!(bad(&|n| n.resolver = "10.0.0.53".into()).contains("resolver range"));
        assert!(bad(&|n| n.zone = "A.otd.internal".into()).contains("zone"));
        assert!(bad(&|n| n.subnet = "172.24.0.32/28".into()).contains("/24 to /27"));
        assert!(bad(&|n| n.subnet = "10.0.0.0/27".into()).contains("workload range"));
        let body = p.network_body();
        assert_eq!(body["Options"][OPT_MTU], "1400");
        // Docker's inspect echoes the create body's fields.
        let inspect =
            json!({"Labels": body["Labels"], "IPAM": body["IPAM"], "Options": body["Options"]});
        p.check_existing(&inspect).unwrap();
        let mut foreign = inspect.clone();
        foreign["Labels"] = json!({});
        assert!(p.check_existing(&foreign).unwrap_err().contains("refusing"));
        let mut other = inspect;
        other["IPAM"]["Config"][0]["Subnet"] = json!("172.24.0.64/27");
        assert!(p.check_existing(&other).unwrap_err().contains("subnets"));
        let mut c = json!({"HostConfig": {}});
        p.attach(&mut c);
        assert_eq!(c["HostConfig"]["Dns"], json!(["172.30.228.1"]));
        assert_eq!(c["HostConfig"]["DnsSearch"], json!(["a.otd.internal"]));
        let e = &c["NetworkingConfig"]["EndpointsConfig"]["otd-scope-a"];
        assert_eq!(e["IPAMConfig"]["IPv4Address"], "172.24.0.34");
        assert!(
            e.get("Aliases").is_none(),
            "names come from the resolver only"
        );
    }

    fn owner() -> Owner {
        Owner {
            install_id: "inst".parse().unwrap(),
            node_id: "node-1".parse().unwrap(),
        }
    }

    fn local(grant: &str, addr: &str, vip: Option<Ipv4Addr>, alias: &str, live: bool) -> Local {
        Local {
            grant: grant.parse().unwrap(),
            slot: SlotRef::new(grant.parse().unwrap(), 0),
            generation: U53::ONE,
            attempt: format!("att-{grant}").parse().unwrap(),
            place: Place::check(&net(addr, vip)).unwrap(),
            entry: Entry {
                aliases: vec![alias.to_owned()],
                ports: vec![PortMap {
                    proto: Proto::Tcp,
                    port: 5432,
                    target: 5432,
                }],
            },
            live,
        }
    }

    #[test]
    fn the_zone_has_one_view_per_resolver_with_vips_and_live_backends() {
        let mut b = ZoneBuilder::default();
        b.local(&local("db", "172.24.0.34", Some(VIP), "db", true), 1_000);
        b.local(&local("w1", "172.24.0.35", None, "web", true), 1_000);
        b.local(&local("w2", "172.24.0.36", None, "web", false), 1_000);
        let mut other = local("c", "172.24.0.37", None, "c", true);
        other.place.resolver = Ipv4Addr::new(172, 30, 228, 2);
        other.place.zone = "b.otd.internal".into();
        b.local(&other, 1_000);
        let z = b.build(7);
        assert_eq!(z.managed, ["otd.internal."]);
        let a = &z.views[&Ipv4Addr::new(172, 30, 228, 1)];
        assert_eq!(a.zones, ["a.otd.internal."]);
        assert_eq!(a.names["db.a.otd.internal."], Record::Vip { addr: VIP });
        let backend = RrBackend {
            addr: Ipv4Addr::new(172, 24, 0, 35),
            expires_unix_ms: 1_000 + ELIGIBILITY_TTL_MS,
        };
        let web = Record::Rr {
            backends: vec![backend],
        };
        assert_eq!(
            a.names["web.a.otd.internal."], web,
            "revoked backends left out"
        );
        let bv = &z.views[&Ipv4Addr::new(172, 30, 228, 2)];
        assert_eq!(bv.names.keys().collect::<Vec<_>>(), ["c.b.otd.internal."]);
    }

    #[test]
    fn local_backends_forward_while_fresh_and_are_withdrawn_for_good() {
        let mut f = Forwarder::default();
        let db = local("db", "172.24.0.34", Some(VIP), "db", true);
        let live = groups(std::slice::from_ref(&db));
        assert!(f.advance(&live, &owner(), 10_000).unwrap());
        let ttl = Duration::from_millis(ELIGIBILITY_TTL_MS);
        assert_eq!(
            (
                f.views(10_000)[0].backends[0].addr,
                f.views(10_000)[0].backends[0].remaining
            ),
            (DB, ttl)
        );
        // Unchanged admission installs nothing; freshness is renewed.
        assert!(!f.advance(&live, &owner(), 20_000).unwrap());
        assert_eq!(f.views(20_000)[0].backends[0].remaining, ttl);
        assert!(
            f.views(20_000 + ELIGIBILITY_TTL_MS)[0].backends.is_empty(),
            "lease ran out"
        );
        // Revoked: withdrawn once, the VIP stays and refuses.
        let gone = Local { live: false, ..db };
        assert!(f.advance(&groups(&[gone]), &owner(), 30_000).unwrap());
        assert!(f.views(30_000)[0].backends.is_empty());
        assert_eq!(f.take_drains(30_000), [(VIP, DB)]);
        assert!(f.take_drains(30_000).is_empty());
        // A withdrawn attempt never comes back, also after a restart.
        let mut back: Forwarder =
            serde_json::from_str(&serde_json::to_string(&f).unwrap()).unwrap();
        back.receiver = back.receiver.restarted(40_000, false);
        assert!(back.advance(&live, &owner(), 40_000).is_err());
        let nft = render_nft(
            &back.views(50_000),
            &BTreeSet::from(["172.24.0.32/27".parse().unwrap()]),
        );
        assert!(nft.contains("elements = { 172.31.0.10 }") && !nft.contains("dnat ip to"));
        assert!(nft.contains("ct status dnat ip saddr 172.24.0.32/27 ip daddr 172.24.0.32/27"));
    }

    /// A host where every command succeeds; records the calls.
    #[derive(Debug, Default)]
    struct Recorder {
        calls: Mutex<Vec<String>>,
        dummy: Mutex<Option<String>>,
    }

    impl Runner for Recorder {
        fn run(
            &self,
            p: &str,
            a: &[&str],
            _: Option<&str>,
            _: Duration,
        ) -> Result<Output, CmdError> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("{p} {}", a.join(" ")));
            let mut dummy = self.dummy.lock().unwrap();
            let mut out = Output {
                code: Some(0),
                ..Output::default()
            };
            match a {
                ["link", "show", ..] if dummy.is_none() => out.code = Some(1),
                ["link", "add", ..] => *dummy = Some(String::new()),
                ["addr", "add", cidr, ..] => {
                    *dummy.get_or_insert_default() +=
                        &["9: otd-dns0 inet ", cidr, " scope global\n"].concat();
                }
                ["-o", "-4", "addr", ..] => out.stdout = dummy.clone().unwrap_or_default(),
                ["is-active", ..] => out.code = Some(3),
                _ => {}
            }
            Ok(out)
        }
    }

    #[test]
    fn sync_writes_the_zone_the_listeners_the_unit_and_the_table() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = NetConfig {
            state_dir: dir.path().join("net"),
            zone_file: dir.path().join("dns/zone.json"),
            unit_dir: dir.path().join("units"),
            ..NetConfig::default()
        };
        let unit = cfg.unit_dir.join("otterd-dns.service");
        let rec = Arc::new(Recorder::default());
        let n = NodeNet::open(cfg.clone(), rec.clone(), 1_000).unwrap();
        let mut state = NodeState::default();
        n.sync(&state, 1_000).unwrap();
        assert!(
            rec.calls.lock().unwrap().is_empty(),
            "no network grants, nothing touched"
        );
        let key = otterd_proto::envelope::PublicKey::from_bytes([1; 32]);
        state.identity = Some(otterd_journal::IdentityState {
            install_id: "inst".parse().unwrap(),
            node_id: "node-1".parse().unwrap(),
            node_epoch: otterd_proto::U53::ONE,
            key_epoch: otterd_proto::U53::ONE,
            identity_key_id: key.key_id(),
            cp_keys: vec![],
            recovery_key: key,
            host: otterd_proto::identity::HostBinding {
                machine_id: "m".into(),
                product_uuid: None,
                provider: None,
            },
        });
        let db: GrantId = "db".parse().unwrap();
        n.record(&db, local("db", "172.24.0.34", Some(VIP), "db", true).entry)
            .unwrap();
        let mut g = grant_state(net("172.24.0.34", Some(VIP)));
        state.grants.insert(db.clone(), g.clone());
        n.sync(&state, 2_000).unwrap();
        let zone: Zone = read_json(&cfg.zone_file).unwrap();
        assert!(
            zone.views[&Ipv4Addr::new(172, 30, 228, 1)]
                .names
                .contains_key("db.a.otd.internal.")
        );
        assert!(
            std::fs::read_to_string(&unit)
                .unwrap()
                .contains("--listen 172.30.228.1\n")
        );
        let calls = rec.calls.lock().unwrap().clone();
        for want in [
            "ip addr add 172.30.228.1/32 dev otd-dns0",
            "systemctl restart otterd-dns.service",
            "nft -f -",
        ] {
            assert!(calls.iter().any(|c| c == want), "{want} in {calls:?}");
        }
        let table = || std::fs::read_to_string(cfg.state_dir.join("vip.nft")).unwrap();
        assert!(table().contains("dnat ip to 172.24.0.34:5432"));
        rec.calls.lock().unwrap().clear();
        n.sync(&state, 3_000).unwrap();
        assert!(
            rec.calls.lock().unwrap().is_empty(),
            "nothing changed, nothing touched"
        );
        // Released: the name, the listener and the backend go.
        g.revoked = Some("stop".into());
        g.superseded_by_epoch = Some(U53::ONE);
        state.grants.insert(db, g);
        n.sync(&state, 4_000).unwrap();
        assert!(read_json::<Zone>(&cfg.zone_file).unwrap().views.is_empty());
        assert!(!unit.exists() && !table().contains("dnat ip to"));
        let calls = rec.calls.lock().unwrap().clone();
        assert!(calls.contains(&"ip addr del 172.30.228.1/32 dev otd-dns0".to_owned()));
        assert!(calls.contains(&"systemctl disable --now otterd-dns.service".to_owned()));
        let again = NodeNet::open(cfg, rec, 5_000).unwrap();
        let inner = again.lock().unwrap();
        assert!(
            !inner.forwarder.is_empty() && inner.book.is_empty(),
            "withdrawal kept, book pruned"
        );
    }

    fn grant_state(network: GrantNetwork) -> otterd_journal::GrantState {
        otterd_journal::GrantState {
            grant: otterd_proto::lifecycle::SlotGrant {
                grant_id: "db".parse().unwrap(),
                slot: SlotRef::new("db".parse().unwrap(), 0),
                generation: U53::ONE,
                authority_term: U53::ONE,
                node_epoch: U53::ONE,
                incarnation: otterd_proto::ids::Incarnation::mint().unwrap(),
                exclusive: true,
                disconnect_action: otterd_proto::spec::DisconnectAction::Stop,
                restart: otterd_proto::spec::RestartPolicy::default(),
                data_claims: vec![],
                probe_only: false,
                adopts_attempt: None,
                adopts_container: None,
                network: Some(network),
            },
            spec_digest: Sha256Hex::digest(b"s"),
            op_id: "op".parse().unwrap(),
            revoked: None,
            certificate: None,
            superseded_by_epoch: None,
            attempts: vec!["att-db".parse().unwrap()],
            held: None,
            adopted_by: None,
            adopted_container: None,
            adoption_released: None,
        }
    }
}
