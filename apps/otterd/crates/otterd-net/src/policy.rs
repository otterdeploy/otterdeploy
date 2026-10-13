//! The node packet-path policy, rendered as nftables text.
//!
//! One [`NodePolicy`] describes everything a node enforces; [`NodePolicy::render`]
//! turns it into four tables, each replaced atomically by its own
//! `add table` / `delete table` prologue so a load is one transaction:
//!
//! | Table | Hook, priority | Job |
//! |---|---|---|
//! | `inet otterd` | forward −20, input −20 | pair policy on scope units, explicit publication (whole flow), underlay and IPv6 drops, replies on bridges, host principal |
//! | `bridge otterd_l2` | prerouting −300 | per-veth source guard (MAC + IPv4 + ARP tuple), default drop |
//! | `ip otterd_nat` | postrouting 90 and srcnat | VIP hairpin, host-originated VIP flows onto the mesh, egress NAT for scopes without Docker masquerade |
//! | `ip otterd_vipbase` | prerouting −85, output 5 | fail-fast reject for the VIP range when no receiver rule DNAT'd the packet |
//!
//! The iptables-side pieces (the `DOCKER-USER` jump and the no-SNAT `RETURN`
//! that must be rule 1 of nat `POSTROUTING`) live in Docker's tables and are
//! rendered separately by [`NodePolicy::render_docker_chain`].

use std::collections::BTreeSet;
use std::fmt::{self, Write as _};
use std::net::Ipv4Addr;

use serde::{Deserialize, Serialize};

use crate::addr::Ipv4Net;

/// Table names. Fixed so audits and the firewall unit agree on them.
pub mod tables {
    /// Filter policy (forward + input).
    pub const FILTER: &str = "otterd";
    /// Per-veth bridge guard.
    pub const BRIDGE: &str = "otterd_l2";
    /// NAT additions.
    pub const NAT: &str = "otterd_nat";
    /// VIP range baseline reject.
    pub const VIP_BASELINE: &str = "otterd_vipbase";
    /// iptables chain in `ip filter` that `DOCKER-USER` jumps to first.
    pub const DOCKER_CHAIN: &str = "OTTERD-MESH";
}

/// An interface-name pattern: an exact name or a prefix ending in `*`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct IfacePattern(String);

/// An interface pattern that nftables would not accept.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error(
    "{0:?} is not an interface name or prefix* pattern (1-15 of [A-Za-z0-9_.-], optional trailing *)"
)]
pub struct BadPattern(String);

impl IfacePattern {
    /// Validates a pattern.
    ///
    /// # Errors
    /// [`BadPattern`] for empty, overlong or quoting-unsafe names.
    pub fn new(p: impl Into<String>) -> Result<Self, BadPattern> {
        let p = p.into();
        let stem = p.strip_suffix('*').unwrap_or(&p);
        let ok = !stem.is_empty()
            && stem.len() <= 15
            && stem
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-'));
        if ok { Ok(Self(p)) } else { Err(BadPattern(p)) }
    }

    /// The pattern text.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Whether a concrete interface name matches.
    #[must_use]
    pub fn matches(&self, name: &str) -> bool {
        match self.0.strip_suffix('*') {
            Some(prefix) => name.starts_with(prefix),
            None => name == self.0,
        }
    }
}

impl fmt::Display for IfacePattern {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "\"{}\"", self.0)
    }
}

impl TryFrom<String> for IfacePattern {
    type Error = BadPattern;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        Self::new(s)
    }
}

impl From<IfacePattern> for String {
    fn from(p: IfacePattern) -> Self {
        p.0
    }
}

/// Layer-4 protocol of a published port.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Proto {
    /// TCP.
    Tcp,
    /// UDP.
    Udp,
}

impl Proto {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Tcp => "tcp",
            Self::Udp => "udp",
        }
    }
}

/// An explicit public exposure, keyed on the post-DNAT tuple (the workload address and port).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Published {
    /// Workload address the publication DNATs to.
    pub addr: Ipv4Addr,
    /// Protocol.
    pub proto: Proto,
    /// Workload port.
    pub port: u16,
}

/// How a local scope's internet egress is NATed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Egress {
    /// Docker's own MASQUERADE (the bridge was created with masquerading on).
    #[default]
    Docker,
    /// The bridge has `enable_ip_masquerade=false`; otterd masquerades internet egress itself.
    Otterd,
}

/// A scope network present on this node.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalScope {
    /// The network.
    pub network: Ipv4Net,
    /// Egress NAT owner.
    #[serde(default)]
    pub egress: Egress,
}

/// A resolver listener a scope's bridge may query (destination-authorized DNS).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsListener {
    /// The bridge whose workloads may ask.
    pub bridge: IfacePattern,
    /// The listener address.
    pub addr: Ipv4Addr,
}

/// One veth's allowed source tuple for the bridge guard.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VethGuard {
    /// Host-side veth name.
    pub veth: String,
    /// The container interface's MAC.
    pub mac: Mac,
    /// The container interface's IPv4 address.
    pub ip: Ipv4Addr,
    /// Free text for the rule comment (container name or id), sanitised on render.
    pub label: String,
}

/// A MAC address.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Mac([u8; 6]);

/// Text that is not a MAC address.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0:?} is not a MAC address")]
pub struct BadMac(String);

impl std::str::FromStr for Mac {
    type Err = BadMac;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let mut out = [0u8; 6];
        let mut parts = s.split(':');
        for b in &mut out {
            let p = parts.next().ok_or_else(|| BadMac(s.to_owned()))?;
            if p.len() != 2 {
                return Err(BadMac(s.to_owned()));
            }
            *b = u8::from_str_radix(p, 16).map_err(|_| BadMac(s.to_owned()))?;
        }
        if parts.next().is_some() {
            return Err(BadMac(s.to_owned()));
        }
        Ok(Self(out))
    }
}

impl fmt::Display for Mac {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let [o0, o1, o2, o3, o4, o5] = self.0;
        write!(f, "{o0:02x}:{o1:02x}:{o2:02x}:{o3:02x}:{o4:02x}:{o5:02x}")
    }
}

impl TryFrom<String> for Mac {
    type Error = BadMac;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        s.parse()
    }
}

impl From<Mac> for String {
    fn from(m: Mac) -> Self {
        m.to_string()
    }
}

/// Interface names the policy needs to tell apart.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Interfaces {
    /// otterd-managed bridges.
    pub bridges: IfacePattern,
    /// Mesh interfaces; must match both rotation generations.
    pub mesh: IfacePattern,
    /// Bridges Docker manages without otterd (default bridge, compose networks).
    pub docker_bridges: Vec<IfacePattern>,
}

impl Default for Interfaces {
    fn default() -> Self {
        let p = |s: &str| IfacePattern(s.to_owned());
        Self {
            bridges: p("otb-*"),
            mesh: p("otw*"),
            docker_bridges: vec![p("docker0"), p("br-*")],
        }
    }
}

/// Everything one node enforces.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodePolicy {
    /// Interface patterns.
    pub interfaces: Interfaces,
    /// Address space of managed workloads on every node (sources are only legitimate from a
    /// managed bridge or the mesh; destinations need a pair).
    pub workload: Ipv4Net,
    /// Host mesh addresses of every node, both generations: the host principal.
    pub host_mesh: Ipv4Net,
    /// The VIP range.
    pub vip: Ipv4Net,
    /// Directed (source unit, destination unit) pairs. Units are /27s; see [`expand_units`].
    pub pairs: BTreeSet<(Ipv4Net, Ipv4Net)>,
    /// Scope units host-originated system traffic may reach (enforced on the receiving node).
    pub host_reach: BTreeSet<Ipv4Net>,
    /// Explicit public exposure.
    pub published: BTreeSet<Published>,
    /// Ports any Docker container may be reached on from the underlay (the edge).
    pub edge_ports: BTreeSet<u16>,
    /// Scope networks on this node.
    pub local_scopes: Vec<LocalScope>,
    /// Resolver listeners per bridge.
    pub dns: Vec<DnsListener>,
    /// Extra routed prefixes that keep their source across the mesh (adopted/reserved ranges).
    pub no_snat_extra: Vec<Ipv4Net>,
}

/// Schema of the policy document carried by the `firewall.apply` command.
pub const POLICY_SCHEMA: &str = "otterd.firewall-policy/1";

/// A `firewall.apply` document that cannot be used.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DocumentError {
    /// The document is another schema or version.
    #[error("expected schema {POLICY_SCHEMA}, got {0}")]
    Schema(String),
    /// The body does not match its digest.
    #[error("policy document digest does not match its body")]
    Digest,
    /// The body is not a valid policy.
    #[error("policy document: {0}")]
    Parse(String),
}

impl NodePolicy {
    /// Decodes the policy from a `firewall.apply` document (schema and digest checked first).
    ///
    /// # Errors
    /// [`DocumentError`].
    pub fn from_document(
        doc: &otterd_proto::command::OpaqueDocument,
    ) -> Result<Self, DocumentError> {
        if doc.schema != POLICY_SCHEMA {
            return Err(DocumentError::Schema(doc.schema.clone()));
        }
        if !doc.digest_matches() {
            return Err(DocumentError::Digest);
        }
        serde_json::from_str(&doc.body).map_err(|e| DocumentError::Parse(e.to_string()))
    }

    /// Encodes the policy as a `firewall.apply` document.
    ///
    /// # Errors
    /// [`DocumentError::Parse`] if serialization fails (it does not for valid values).
    pub fn to_document(&self) -> Result<otterd_proto::command::OpaqueDocument, DocumentError> {
        let body = serde_json::to_string(self).map_err(|e| DocumentError::Parse(e.to_string()))?;
        Ok(otterd_proto::command::OpaqueDocument {
            schema: POLICY_SCHEMA.to_owned(),
            digest: otterd_proto::ids::Sha256Hex::digest(body.as_bytes()),
            body,
        })
    }
}

/// Splits a network into its /27 policy units (a /24 contributes eight).
#[must_use]
pub fn expand_units(net: Ipv4Net) -> Vec<Ipv4Net> {
    if net.prefix_len() >= crate::ipam::UNIT_LEN {
        return vec![net];
    }
    let n = u32::try_from(net.subnet_count(crate::ipam::UNIT_LEN)).unwrap_or(0);
    (0..n)
        .filter_map(|i| net.subnet(crate::ipam::UNIT_LEN, i))
        .collect()
}

/// Every directed pair between the units of the given networks (a policy group's members).
#[must_use]
pub fn group_pairs(members: &[Ipv4Net]) -> BTreeSet<(Ipv4Net, Ipv4Net)> {
    let units: Vec<Ipv4Net> = members.iter().flat_map(|m| expand_units(*m)).collect();
    units
        .iter()
        .flat_map(|a| units.iter().map(move |b| (*a, *b)))
        .collect()
}

fn comment(text: &str) -> String {
    let clean: String = text
        .chars()
        .filter(|c| {
            c.is_ascii_alphanumeric()
                || matches!(c, ' ' | '-' | '_' | '.' | ':' | '/' | ',' | '(' | ')')
        })
        .take(120)
        .collect();
    format!("comment \"{clean}\"")
}

fn replace_prologue(out: &mut String, family: &str, name: &str) {
    let _ = writeln!(
        out,
        "add table {family} {name}\ndelete table {family} {name}"
    );
}

impl NodePolicy {
    /// The filter table: forward and input policy.
    #[must_use]
    pub fn render_filter(&self) -> String {
        let hm = self.host_mesh;
        let mut o = String::with_capacity(4096);
        replace_prologue(&mut o, "inet", tables::FILTER);
        let _ = writeln!(o, "table inet {} {{", tables::FILTER);

        let published: Vec<String> = self
            .published
            .iter()
            .map(|p| format!("{} . {} . {}", p.addr, p.proto.as_str(), p.port))
            .collect();
        let _ = writeln!(
            o,
            "  set published {{\n    type ipv4_addr . inet_proto . inet_service"
        );
        if !published.is_empty() {
            let _ = writeln!(o, "    elements = {{ {} }}", published.join(", "));
        }
        o.push_str("  }\n");

        let mut pairs: Vec<String> = self
            .pairs
            .iter()
            .map(|(s, d)| format!("{s} . {d}"))
            .collect();
        pairs.extend(self.host_reach.iter().map(|d| format!("{hm} . {d}")));
        let _ = writeln!(
            o,
            "  set allow4 {{\n    type ipv4_addr . ipv4_addr\n    flags interval"
        );
        if !pairs.is_empty() {
            let _ = writeln!(o, "    elements = {{ {} }}", pairs.join(", "));
        }
        o.push_str("  }\n");

        self.render_input(&mut o);
        self.render_forward(&mut o);
        o.push_str("}\n");
        o
    }

    /// Input chain: tenants never open flows to the host, except to their resolver.
    fn render_input(&self, o: &mut String) {
        let br = &self.interfaces.bridges;
        let _ = writeln!(
            o,
            "  chain input {{\n    type filter hook input priority -20; policy accept;"
        );
        for d in &self.dns {
            let _ = writeln!(
                o,
                "    iifname {} ip daddr {} meta l4proto {{ tcp, udp }} th dport 53 counter accept {}",
                d.bridge,
                d.addr,
                comment("scoped resolver")
            );
        }
        let _ = writeln!(
            o,
            "    iifname {br} ct state established,related counter accept {}",
            comment("replies to host-initiated probes, control and VIP flows")
        );
        let _ = writeln!(
            o,
            "    iifname {br} counter drop {}",
            comment("tenant to host")
        );
        o.push_str("  }\n");
    }

    /// Forward chain: order matters, every line is load-bearing.
    fn render_forward(&self, o: &mut String) {
        let br = &self.interfaces.bridges;
        let mesh = &self.interfaces.mesh;
        let wl = self.workload;
        let hm = self.host_mesh;
        let edge: Vec<String> = self.edge_ports.iter().map(u16::to_string).collect();
        let _ = writeln!(
            o,
            "  chain forward {{\n    type filter hook forward priority -20; policy accept;"
        );
        let _ = writeln!(
            o,
            "    tcp flags syn tcp option maxseg size set rt mtu {}",
            comment("MSS clamp")
        );
        let _ = writeln!(o, "    ct state invalid counter drop");
        let _ = writeln!(
            o,
            "    meta nfproto ipv6 iifname {br} counter drop {}",
            comment("no workload ipv6")
        );
        let _ = writeln!(o, "    meta nfproto ipv6 oifname {br} counter drop");
        let _ = writeln!(
            o,
            "    ip saddr {wl} iifname != {br} iifname != {mesh} counter drop {}",
            comment("workload sources only from a managed bridge or the mesh")
        );
        let _ = writeln!(
            o,
            "    ip daddr . meta l4proto . th dport @published iifname != {br} iifname != {mesh} ct state {{ new, established, related }} counter accept {}",
            comment("explicit publication, whole flow")
        );
        let _ = writeln!(
            o,
            "    oifname {br} iifname != {br} iifname != {mesh} ct state new counter drop {}",
            comment("no new underlay flows into managed bridges")
        );
        if !edge.is_empty() {
            let internal = std::iter::once(br)
                .chain(std::iter::once(mesh))
                .chain(self.interfaces.docker_bridges.iter())
                .map(|p| format!("iifname != {p}"))
                .collect::<Vec<_>>()
                .join(" ");
            for db in &self.interfaces.docker_bridges {
                let _ = writeln!(
                    o,
                    "    oifname {db} {internal} ct state new meta l4proto {{ tcp, udp }} th dport != {{ {} }} counter drop {}",
                    edge.join(", "),
                    comment("unmanaged containers: edge ports only")
                );
            }
        }
        let _ = writeln!(
            o,
            "    ct direction reply ct state established,related ip saddr != {wl} iifname != {br} counter accept {}",
            comment("replies to tenant egress")
        );
        let _ = writeln!(
            o,
            "    ct direction reply ct state established,related ip daddr {hm} counter accept {}",
            comment("replies to pair-authorized host flows")
        );
        let _ = writeln!(
            o,
            "    ip saddr . ip daddr @allow4 counter accept {}",
            comment("policy pairs")
        );
        let _ = writeln!(
            o,
            "    ip daddr {wl} counter drop {}",
            comment("managed destination without a pair")
        );
        let _ = writeln!(
            o,
            "    ip saddr {wl} ip daddr {{ 10.0.0.0/8, 100.64.0.0/10, 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16 }} counter drop {}",
            comment("tenant to private and metadata ranges")
        );
        o.push_str("  }\n");
    }

    /// The NAT additions.
    #[must_use]
    pub fn render_nat(&self) -> String {
        let br = &self.interfaces.bridges;
        let mesh = &self.interfaces.mesh;
        let wl = self.workload;
        let mut o = String::with_capacity(1024);
        replace_prologue(&mut o, "ip", tables::NAT);
        let _ = writeln!(o, "table ip {} {{", tables::NAT);
        let _ = writeln!(
            o,
            "  chain vip {{\n    type nat hook postrouting priority 90; policy accept;"
        );
        for s in &self.local_scopes {
            let n = s.network;
            let _ = writeln!(
                o,
                "    ct status dnat ip saddr {n} ip daddr {n} counter masquerade {}",
                comment("VIP hairpin, after the pair policy authorized the client")
            );
        }
        let _ = writeln!(
            o,
            "    oifname {mesh} ct status dnat ip saddr != {wl} counter masquerade {}",
            comment("host-originated VIP flow onto the mesh")
        );
        o.push_str("  }\n");
        let _ = writeln!(
            o,
            "  chain egress {{\n    type nat hook postrouting priority srcnat; policy accept;"
        );
        for s in self
            .local_scopes
            .iter()
            .filter(|s| s.egress == Egress::Otterd)
        {
            let _ = writeln!(
                o,
                "    ip saddr {} ip daddr != {wl} oifname != {br} oifname != {mesh} counter masquerade {}",
                s.network,
                comment("internet egress for a scope without Docker masquerade")
            );
        }
        o.push_str("  }\n}\n");
        o
    }

    /// The VIP-range baseline: refuse fast instead of letting clients time out when no receiver
    /// rule DNAT'd the packet (receiver down, state lost, invalid mid-stream TCP). UDP uses
    /// port-unreachable, the same error the receiver gives for an empty service.
    #[must_use]
    pub fn render_vip_baseline(&self) -> String {
        let v = self.vip;
        let mut o = String::with_capacity(512);
        replace_prologue(&mut o, "ip", tables::VIP_BASELINE);
        let _ = writeln!(o, "table ip {} {{", tables::VIP_BASELINE);
        for (chain, hook, prio) in [("pre", "prerouting", "-85"), ("out", "output", "5")] {
            let _ = writeln!(
                o,
                "  chain {chain} {{\n    type filter hook {hook} priority {prio}; policy accept;"
            );
            let _ = writeln!(
                o,
                "    ip daddr {v} meta l4proto tcp counter reject with tcp reset"
            );
            let _ = writeln!(
                o,
                "    ip daddr {v} meta l4proto udp counter reject with icmp type port-unreachable"
            );
            o.push_str("  }\n");
        }
        o.push_str("}\n");
        o
    }

    /// Static parts plus the current policy generation, as one transaction.
    #[must_use]
    pub fn render(&self) -> String {
        let mut o = self.render_filter();
        o.push_str(&self.render_nat());
        o.push_str(&self.render_vip_baseline());
        o
    }

    /// `iptables-restore --noflush` input for the chain `DOCKER-USER` must jump to first:
    /// accept what the otterd filter already authorized so Docker's isolation chains do not
    /// drop it. Declaring the chain flushes it, so a load fully replaces it.
    #[must_use]
    pub fn render_docker_chain(&self) -> String {
        let wl = self.workload;
        let c = tables::DOCKER_CHAIN;
        let mut o = format!("*filter\n:{c} - [0:0]\n");
        let _ = writeln!(o, "-A {c} -s {wl} -d {wl} -j ACCEPT");
        if !wl.covers(&self.host_mesh) {
            let _ = writeln!(o, "-A {c} -s {} -d {wl} -j ACCEPT", self.host_mesh);
        }
        for p in &self.published {
            let _ = writeln!(
                o,
                "-A {c} ! -s {wl} -d {}/32 -p {proto} -m {proto} --dport {} -j ACCEPT",
                p.addr,
                p.port,
                proto = p.proto.as_str()
            );
        }
        let _ = writeln!(o, "-A {c} -j RETURN\nCOMMIT");
        o
    }

    /// Source prefixes that must keep their address when crossing the mesh: the no-SNAT
    /// `RETURN` rules, which must be first in nat `POSTROUTING`, ahead of Docker's MASQUERADE.
    #[must_use]
    pub fn no_snat_prefixes(&self) -> Vec<Ipv4Net> {
        let mut v = vec![self.workload];
        v.extend(self.no_snat_extra.iter().copied());
        v
    }
}

/// Renders the bridge guard for the given veths. Anything not listed (a veth whose rules are not
/// installed yet, IPv6, other ethertypes, forged sources) hits the default drop: the failure mode
/// of a slow or dead reconciler is closed, not open.
#[must_use]
pub fn render_bridge_guard(bridges: &IfacePattern, veths: &[VethGuard]) -> String {
    let mut o = String::with_capacity(256 + veths.len() * 256);
    replace_prologue(&mut o, "bridge", tables::BRIDGE);
    let _ = writeln!(o, "table bridge {} {{", tables::BRIDGE);
    let _ = writeln!(
        o,
        "  chain ingress {{\n    type filter hook prerouting priority -300; policy accept;"
    );
    for v in veths {
        let Ok(veth) = IfacePattern::new(v.veth.clone()) else {
            continue;
        };
        if veth.as_str().ends_with('*') {
            continue;
        }
        let c = comment(&v.label);
        let _ = writeln!(
            o,
            "    iifname {veth} ether saddr {} ip saddr {} counter accept {c}",
            v.mac, v.ip
        );
        let _ = writeln!(
            o,
            "    iifname {veth} ether saddr {mac} arp saddr ip {ip} arp saddr ether {mac} counter accept {c}",
            mac = v.mac,
            ip = v.ip
        );
    }
    let _ = writeln!(
        o,
        "    meta ibrname {bridges} counter drop {}",
        comment("default deny")
    );
    o.push_str("  }\n}\n");
    o
}

#[cfg(test)]
mod tests {
    use super::*;

    fn net(s: &str) -> Ipv4Net {
        s.parse().unwrap()
    }

    fn sample() -> NodePolicy {
        let a: Vec<Ipv4Net> = ["172.24.0.0/27", "172.24.32.0/27"]
            .iter()
            .map(|s| net(s))
            .collect();
        NodePolicy {
            interfaces: Interfaces::default(),
            workload: net("172.24.0.0/13"),
            host_mesh: net("172.30.224.0/23"),
            vip: net("172.31.0.0/16"),
            pairs: group_pairs(&a),
            host_reach: [net("172.24.0.0/27")].into(),
            published: [Published {
                addr: Ipv4Addr::new(172, 24, 0, 10),
                proto: Proto::Tcp,
                port: 8080,
            }]
            .into(),
            edge_ports: [80, 443].into(),
            local_scopes: vec![
                LocalScope {
                    network: net("172.24.0.0/27"),
                    egress: Egress::Docker,
                },
                LocalScope {
                    network: net("172.24.0.32/27"),
                    egress: Egress::Otterd,
                },
            ],
            dns: vec![DnsListener {
                bridge: IfacePattern::new("otb-a").unwrap(),
                addr: Ipv4Addr::new(172, 30, 228, 1),
            }],
            no_snat_extra: vec![],
        }
    }

    fn position(text: &str, needle: &str) -> usize {
        text.find(needle)
            .unwrap_or_else(|| panic!("missing {needle:?} in\n{text}"))
    }

    #[test]
    fn published_accept_covers_the_whole_flow_and_precedes_the_bridge_drop() {
        let f = sample().render_filter();
        let accept = position(
            &f,
            "@published iifname != \"otb-*\" iifname != \"otw*\" ct state { new, established, related } counter accept",
        );
        let drop_new = position(
            &f,
            "oifname \"otb-*\" iifname != \"otb-*\" iifname != \"otw*\" ct state new counter drop",
        );
        let dest_drop = position(&f, "ip daddr 172.24.0.0/13 counter drop");
        assert!(accept < drop_new && drop_new < dest_drop);
    }

    #[test]
    fn host_principal_pairs_and_reply_accept_are_present() {
        let f = sample().render_filter();
        assert!(f.contains("172.30.224.0/23 . 172.24.0.0/27"));
        let reply = position(
            &f,
            "ct direction reply ct state established,related ip daddr 172.30.224.0/23 counter accept",
        );
        assert!(reply < position(&f, "@allow4 counter accept"));
    }

    #[test]
    fn input_accepts_bridge_replies_and_scoped_dns_then_drops() {
        let f = sample().render_filter();
        let dns = position(
            &f,
            "iifname \"otb-a\" ip daddr 172.30.228.1 meta l4proto { tcp, udp } th dport 53",
        );
        let replies = position(
            &f,
            "iifname \"otb-*\" ct state established,related counter accept",
        );
        let drop = position(&f, "iifname \"otb-*\" counter drop");
        assert!(dns < replies && replies < drop);
    }

    #[test]
    fn group_pairs_are_directed_over_units() {
        let p = group_pairs(&[net("172.24.0.0/26"), net("172.24.32.0/27")]);
        assert_eq!(p.len(), 9);
        assert!(p.contains(&(net("172.24.0.32/27"), net("172.24.32.0/27"))));
        assert!(p.contains(&(net("172.24.32.0/27"), net("172.24.0.32/27"))));
    }

    #[test]
    fn nat_hairpins_local_scopes_and_masquerades_host_vip_flows() {
        let n = sample().render_nat();
        assert!(n.contains(
            "ct status dnat ip saddr 172.24.0.0/27 ip daddr 172.24.0.0/27 counter masquerade"
        ));
        assert!(n.contains(
            "oifname \"otw*\" ct status dnat ip saddr != 172.24.0.0/13 counter masquerade"
        ));
        assert!(n.contains("ip saddr 172.24.0.32/27 ip daddr != 172.24.0.0/13"));
        assert!(!n.contains("ip saddr 172.24.0.0/27 ip daddr != 172.24.0.0/13"));
    }

    #[test]
    fn vip_baseline_uses_port_unreachable_for_udp() {
        let v = sample().render_vip_baseline();
        assert_eq!(
            v.matches("reject with icmp type port-unreachable").count(),
            2
        );
        assert!(!v.contains("admin-prohibited"));
        assert!(v.contains("priority -85") && v.contains("hook output priority 5"));
    }

    #[test]
    fn unmanaged_docker_bridges_get_the_persistent_tcp_and_udp_edge_guard() {
        let f = sample().render_filter();
        assert!(f.contains("oifname \"docker0\""));
        assert!(f.contains(
            "ct state new meta l4proto { tcp, udp } th dport != { 80, 443 } counter drop"
        ));
    }

    #[test]
    fn docker_chain_accepts_mesh_and_publications_then_returns() {
        let d = sample().render_docker_chain();
        assert!(d.starts_with("*filter\n:OTTERD-MESH - [0:0]\n"));
        assert!(d.contains("-A OTTERD-MESH -s 172.24.0.0/13 -d 172.24.0.0/13 -j ACCEPT"));
        assert!(d.contains("-d 172.24.0.10/32 -p tcp -m tcp --dport 8080 -j ACCEPT"));
        assert!(d.ends_with("-A OTTERD-MESH -j RETURN\nCOMMIT\n"));
    }

    #[test]
    fn bridge_guard_is_default_deny_and_skips_unsafe_names() {
        let veths = vec![
            VethGuard {
                veth: "veth1a2b".into(),
                mac: "02:42:ac:18:00:02".parse().unwrap(),
                ip: Ipv4Addr::new(172, 24, 0, 2),
                label: "web \"x\"".into(),
            },
            VethGuard {
                veth: "bad name".into(),
                mac: "02:42:ac:18:00:03".parse().unwrap(),
                ip: Ipv4Addr::new(172, 24, 0, 3),
                label: String::new(),
            },
        ];
        let g = render_bridge_guard(&IfacePattern::new("otb-*").unwrap(), &veths);
        assert!(g.contains("iifname \"veth1a2b\" ether saddr 02:42:ac:18:00:02 ip saddr 172.24.0.2 counter accept comment \"web x\""));
        assert!(!g.contains("bad name"));
        assert!(
            g.trim_end()
                .ends_with("meta ibrname \"otb-*\" counter drop comment \"default deny\"\n  }\n}")
        );
    }

    #[test]
    fn patterns_and_macs_validate() {
        assert!(IfacePattern::new("otb-*").unwrap().matches("otb-3f"));
        assert!(!IfacePattern::new("otb-*").unwrap().matches("br-3f"));
        assert!(IfacePattern::new("a\"b").is_err());
        assert!(IfacePattern::new("sixteen-chars-xx").is_err());
        assert!("02:42:ac:18:00".parse::<Mac>().is_err());
        assert_eq!(
            "02:42:AC:18:00:02".parse::<Mac>().unwrap().to_string(),
            "02:42:ac:18:00:02"
        );
    }

    #[test]
    fn firewall_apply_document_round_trips_and_is_checked() {
        let p = sample();
        let doc = p.to_document().unwrap();
        assert_eq!(doc.schema, POLICY_SCHEMA);
        assert_eq!(NodePolicy::from_document(&doc).unwrap(), p);
        let mut tampered = doc.clone();
        tampered.body = tampered.body.replace("443", "444");
        assert_eq!(
            NodePolicy::from_document(&tampered),
            Err(DocumentError::Digest)
        );
        let other = otterd_proto::command::OpaqueDocument {
            schema: "otterd.proxy-routes/1".into(),
            ..doc
        };
        assert!(matches!(
            NodePolicy::from_document(&other),
            Err(DocumentError::Schema(_))
        ));
    }

    #[test]
    fn every_table_is_replaced_atomically() {
        let r = sample().render();
        for (fam, t) in [
            ("inet", "otterd"),
            ("ip", "otterd_nat"),
            ("ip", "otterd_vipbase"),
        ] {
            assert!(r.contains(&format!(
                "add table {fam} {t}\ndelete table {fam} {t}\ntable {fam} {t} {{"
            )));
        }
    }
}
