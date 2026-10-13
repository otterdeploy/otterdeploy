//! The node's own packet policy: environment isolation, written for the
//! `otterd-net` agent to enforce.
//!
//! Like the zone, the policy is derived from the scope networks of the
//! unreleased grants on this node, and nothing else:
//!
//! - every scope network is a local scope (its subnet; the Engine keeps
//!   masquerading its internet egress);
//! - a scope reaches itself and nothing else: one pair per ordered pair of
//!   the scope's own /27 units, never a pair between two scopes. A VIP flow
//!   is authorized by the same pairs: the receiver DNATs before the forward
//!   hook, so the pair policy sees the backend's address, and a client in
//!   another scope is dropped as a managed destination without a pair;
//! - each scope's bridge may query its own resolver and no other: one
//!   listener per (bridge, resolver), checked on the destination address;
//! - a port published on the host reaches its container (the whole flow);
//! - the edge proxy's bridges (`OTTERD_EDGE_BRIDGES`, written by the
//!   installer) reach the scopes that hold VIP backends, only through a VIP
//!   (a DNAT'd flow whose original destination is in the VIP range). Both
//!   otterd's filter and its chain at the head of `DOCKER-USER` accept it,
//!   so neither the Engine's isolation nor an installer guard drops it.
//!   With no edge bridge or no VIP backend, neither rule exists.
//!
//! The scope bridges run in the Engine's `nat-unprotected` gateway mode, so
//! the Engine's own filter adds nothing: what reaches a scope, its resolver
//! or its VIPs is decided here. Pairs between nodes, scopes on other nodes
//! and VIPs of remote serving sets come with the cross-node receiver.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use otterd_net::ipam;
use otterd_net::policy::{
    DnsListener, Egress, IfacePattern, Interfaces, LocalScope, NodePolicy, Published, group_pairs,
};

use crate::net::Local;

/// An edge bridge name: an exact interface name, never a scope bridge or the
/// mesh, which stay under the pair policy.
pub fn edge_bridge(name: &str) -> Result<IfacePattern, String> {
    let p = IfacePattern::new(name.trim()).map_err(|e| format!("edge bridge: {e}"))?;
    let i = Interfaces::default();
    let s = p.as_str();
    let managed = i.bridges.as_str().trim_end_matches('*');
    let mesh = i.mesh.as_str().trim_end_matches('*');
    if s.ends_with('*') || s.starts_with(managed) || s.starts_with(mesh) {
        return Err(format!(
            "edge bridge {s:?} must be one interface name, not a scope bridge or the mesh"
        ));
    }
    Ok(p)
}

/// The policy for the local scopes of these grants, with the edge proxy's
/// bridges. An empty input gives the empty policy, which still keeps tenants
/// off the host and other scopes.
pub fn derive(locals: &[Local], edge: &[IfacePattern]) -> Result<NodePolicy, String> {
    let layout = ipam::Layout::default();
    let mut scopes = BTreeSet::new();
    let mut vip_backends = BTreeSet::new();
    let mut dns = BTreeMap::new();
    let mut published = BTreeSet::new();
    for l in locals {
        let p = &l.place;
        scopes.insert(p.subnet);
        if p.vip.is_some() {
            vip_backends.insert(p.subnet);
        }
        let bridge = IfacePattern::new(p.bridge()).map_err(|e| e.to_string())?;
        dns.insert((p.resolver, bridge.as_str().to_owned()), bridge);
        for port in &l.entry.host_ports {
            published.insert(Published {
                addr: p.address,
                proto: port.proto,
                port: port.target,
            });
        }
    }
    let nets: Vec<_> = scopes.iter().copied().collect();
    Ok(NodePolicy {
        interfaces: Interfaces::default(),
        workload: layout.supernet,
        host_mesh: layout.mesh,
        vip: layout.vip,
        pairs: nets.iter().flat_map(|n| group_pairs(&[*n])).collect(),
        host_reach: BTreeSet::new(),
        published,
        edge_ports: BTreeSet::new(),
        local_scopes: nets
            .into_iter()
            .map(|network| LocalScope {
                network,
                egress: Egress::Docker,
            })
            .collect(),
        dns: dns
            .into_iter()
            .map(|((addr, _), bridge)| DnsListener { bridge, addr })
            .collect(),
        no_snat_extra: Vec::new(),
        edge_bridges: if vip_backends.is_empty() {
            Vec::new()
        } else {
            edge.to_vec()
        },
        vip_backends: if edge.is_empty() {
            Vec::new()
        } else {
            vip_backends.into_iter().collect()
        },
    })
}

/// The policy file's text.
pub fn to_json(p: &NodePolicy) -> Result<String, String> {
    serde_json::to_string_pretty(p)
        .map(|t| t + "\n")
        .map_err(|e| e.to_string())
}

/// The agent's unit. `packaging/systemd/otterd-net.service` is this text for
/// the default paths.
pub fn render_agent_unit(binary: &Path, policy: &Path) -> String {
    format!(
        "# otterd-net: the node's packet policy agent.\n\
         #\n\
         # otterd installs this unit as /etc/systemd/system/otterd-net.service, with\n\
         # the binary and policy file it is configured with (OTTERD_NET_BINARY,\n\
         # OTTERD_NET_POLICY), and starts it once a scope network exists on the node.\n\
         # The agent applies the policy otterd writes (environment isolation, resolver\n\
         # access, published ports, the VIP hairpin), guards every container interface\n\
         # on a scope bridge, keeps its chain first in DOCKER-USER, and re-applies the\n\
         # policy after drift. otterd-firewall.service loads the last applied generation\n\
         # at boot, before Docker.\n\
         \n\
         [Unit]\n\
         Description=otterdeploy packet policy agent\n\
         Documentation=https://otterdeploy.com/docs\n\
         # Ordered after the persisted generation and the Engine, never requiring the\n\
         # Engine: interfaces stay guarded while dockerd is down or restarting.\n\
         After=otterd-firewall.service docker.service\n\
         Wants=otterd-firewall.service\n\
         StartLimitIntervalSec=0\n\
         \n\
         [Service]\n\
         # Ready once the first pass has applied the policy.\n\
         Type=notify\n\
         NotifyAccess=main\n\
         # Petted only after a completed pass: a wedged agent is restarted.\n\
         WatchdogSec=30s\n\
         Restart=always\n\
         RestartSec=1s\n\
         ExecStart={binary} agent {policy}\n\
         NoNewPrivileges=yes\n\
         ProtectSystem=full\n\
         ProtectHome=yes\n\
         PrivateTmp=yes\n\
         LockPersonality=yes\n\
         RestrictRealtime=yes\n\
         \n\
         [Install]\n\
         WantedBy=multi-user.target\n",
        binary = binary.display(),
        policy = policy.display(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::net::{Entry, Place};
    use otterd_net::Ipv4Net;
    use otterd_net::policy::Proto;
    use otterd_net::vip::PortMap;
    use otterd_proto::U53;
    use otterd_proto::ids::SlotRef;
    use otterd_proto::lifecycle::GrantNetwork;
    use std::net::Ipv4Addr;

    fn local(env: char, host: u8, published: Option<u16>) -> Local {
        let (base, n) = if env == 'a' { (32, 1) } else { (64, 2) };
        let place = Place::check(&GrantNetwork {
            scope_id: format!("scope-{env}").parse().unwrap(),
            subnet: format!("172.24.0.{base}/27"),
            address: format!("172.24.0.{}", base + host),
            resolver: format!("172.30.228.{n}"),
            zone: format!("{env}.otd.internal"),
            vip: None,
        })
        .unwrap();
        let grant = format!("g-{env}{host}");
        Local {
            grant: grant.parse().unwrap(),
            slot: SlotRef::new(grant.parse().unwrap(), 0),
            generation: U53::ONE,
            attempt: format!("att-{grant}").parse().unwrap(),
            place,
            entry: Entry {
                host_ports: published
                    .map(|p| PortMap {
                        proto: Proto::Tcp,
                        port: p,
                        target: 8080,
                    })
                    .into_iter()
                    .collect(),
                ..Entry::default()
            },
            live: true,
        }
    }

    fn net(s: &str) -> Ipv4Net {
        s.parse().unwrap()
    }

    #[test]
    fn each_scope_reaches_itself_and_its_resolver_and_nothing_else() {
        let locals = [
            local('a', 2, None),
            local('a', 3, Some(18080)),
            local('b', 2, None),
        ];
        let p = derive(&locals, &[]).unwrap();
        let (a, b) = (net("172.24.0.32/27"), net("172.24.0.64/27"));
        assert_eq!(
            p.local_scopes
                .iter()
                .map(|s| (s.network, s.egress))
                .collect::<Vec<_>>(),
            [(a, Egress::Docker), (b, Egress::Docker)]
        );
        assert_eq!(
            p.pairs,
            BTreeSet::from([(a, a), (b, b)]),
            "no pair across scopes"
        );
        let dns: Vec<(String, Ipv4Addr)> = p
            .dns
            .iter()
            .map(|d| (d.bridge.as_str().to_owned(), d.addr))
            .collect();
        assert_eq!(
            dns,
            [
                (locals[0].place.bridge(), Ipv4Addr::new(172, 30, 228, 1)),
                (locals[2].place.bridge(), Ipv4Addr::new(172, 30, 228, 2)),
            ]
        );
        assert_eq!(
            p.published,
            BTreeSet::from([Published {
                addr: Ipv4Addr::new(172, 24, 0, 35),
                proto: Proto::Tcp,
                port: 8080,
            }])
        );
        assert!(p.host_reach.is_empty() && p.edge_ports.is_empty());
        let layout = ipam::Layout::default();
        assert_eq!((p.workload, p.vip), (layout.supernet, layout.vip));

        // What the agent loads: A's bridge asks only A's resolver, and the
        // hairpin masquerades a VIP flow only inside one scope.
        let text = p.render();
        let bridge_a = locals[0].place.bridge();
        assert!(text.contains(&format!(
            "iifname \"{bridge_a}\" ip daddr 172.30.228.1 meta l4proto {{ tcp, udp }} th dport 53 counter accept"
        )));
        assert!(!text.contains(&format!("iifname \"{bridge_a}\" ip daddr 172.30.228.2")));
        assert!(text.contains(
            "elements = { 172.24.0.32/27 . 172.24.0.32/27, 172.24.0.64/27 . 172.24.0.64/27 }"
        ));
        assert!(text.contains(
            "ct status dnat ip saddr 172.24.0.32/27 ip daddr 172.24.0.32/27 counter masquerade"
        ));
        assert!(!text.contains("ip saddr 172.24.0.32/27 ip daddr 172.24.0.64/27"));
    }

    #[test]
    fn a_larger_scope_pairs_all_its_units_and_the_policy_round_trips() {
        let mut big = local('a', 2, None);
        big.place.subnet = net("172.24.1.0/24");
        let p = derive(&[big], &[]).unwrap();
        assert_eq!(p.pairs.len(), 64, "eight /27 units, every ordered pair");
        assert!(p.pairs.iter().all(
            |(s, d)| p.local_scopes[0].network.covers(s) && p.local_scopes[0].network.covers(d)
        ));
        let text = to_json(&p).unwrap();
        let back: NodePolicy = serde_json::from_str(&text).unwrap();
        assert_eq!(back, p);
    }

    #[test]
    fn no_scopes_is_the_empty_policy() {
        let p = derive(&[], &[]).unwrap();
        assert!(p.local_scopes.is_empty() && p.pairs.is_empty() && p.dns.is_empty());
        let text = p.render();
        assert!(
            text.contains("iifname \"otb-*\" counter drop"),
            "tenants stay off the host"
        );
        assert!(text.contains("ip daddr 172.24.0.0/13 counter drop"));
        assert!(!text.contains("masquerade comment \"VIP hairpin"));
    }

    #[test]
    fn the_edge_reaches_vip_backends_while_there_are_any() {
        let edge = [edge_bridge("br-edge").unwrap()];
        let mut db = local('a', 2, None);
        db.place.vip = Some(("vip-db".parse().unwrap(), Ipv4Addr::new(172, 31, 0, 10)));
        let p = derive(&[db.clone(), local('b', 2, None)], &edge).unwrap();
        assert_eq!(p.edge_bridges, edge);
        assert_eq!(p.vip_backends, [net("172.24.0.32/27")], "B has no VIP");
        assert!(p.render().contains("edge to a VIP backend"));
        // No VIP service, or no edge bridge: no rule at all.
        let none = derive(&[local('a', 2, None)], &edge).unwrap();
        assert!(none.edge_bridges.is_empty() && none.vip_backends.is_empty());
        let none = derive(&[db], &[]).unwrap();
        assert!(none.edge_bridges.is_empty() && none.vip_backends.is_empty());
        assert!(!none.render_docker_chain().contains("ctorigdst"));
        for bad in ["otb-1234abcd", "otb-*", "otw0", "br-*", "a b"] {
            assert!(edge_bridge(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn the_packaged_unit_is_the_rendered_default() {
        let packaged = include_str!("../../../packaging/systemd/otterd-net.service");
        let rendered = render_agent_unit(
            Path::new("/usr/lib/otterd/otterd-net"),
            Path::new("/var/lib/otterd/net/policy.json"),
        );
        assert_eq!(packaged, rendered);
        for line in [
            "Type=notify",
            "WatchdogSec=30s",
            "Restart=always",
            "StartLimitIntervalSec=0",
            "After=otterd-firewall.service docker.service",
        ] {
            assert!(rendered.contains(&format!("{line}\n")), "{line}");
        }
    }
}
