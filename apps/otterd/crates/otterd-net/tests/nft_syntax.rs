//! Checks every rendered table against the host's own `nft` parser (`nft -c`, no change made).
//!
//! Needs root and nftables, so it is ignored by default:
//! `cargo test -p otterd-net --test nft_syntax -- --ignored`.

// Test helpers outside #[test] fns: a panic is the failure report here.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::net::Ipv4Addr;
use std::time::Duration;

use otterd_net::cmd::{Runner, System};
use otterd_net::policy::{
    DnsListener, Egress, IfacePattern, Interfaces, LocalScope, NodePolicy, Proto, Published,
    VethGuard, group_pairs, render_bridge_guard,
};
use otterd_net::vip::{Backend, PortMap, VipView, render};

fn check(text: &str) {
    let out = System
        .run(
            "nft",
            &["-c", "-f", "-"],
            Some(text),
            Duration::from_secs(20),
        )
        .expect("nft runs");
    assert!(out.success(), "nft rejected:\n{}\n---\n{text}", out.stderr);
}

fn policy() -> NodePolicy {
    let members: Vec<_> = ["172.24.0.0/27", "172.24.32.0/26", "172.24.64.0/24"]
        .iter()
        .map(|s| s.parse().unwrap())
        .collect();
    NodePolicy {
        interfaces: Interfaces::default(),
        workload: "172.24.0.0/13".parse().unwrap(),
        host_mesh: "172.30.224.0/23".parse().unwrap(),
        vip: "172.31.0.0/16".parse().unwrap(),
        pairs: group_pairs(&members),
        host_reach: ["172.24.0.0/27".parse().unwrap()].into(),
        published: [
            Published {
                addr: Ipv4Addr::new(172, 24, 0, 10),
                proto: Proto::Tcp,
                port: 8080,
            },
            Published {
                addr: Ipv4Addr::new(172, 24, 0, 11),
                proto: Proto::Udp,
                port: 443,
            },
        ]
        .into(),
        edge_ports: [80, 443].into(),
        local_scopes: vec![
            LocalScope {
                network: "172.24.0.0/27".parse().unwrap(),
                egress: Egress::Docker,
            },
            LocalScope {
                network: "172.24.0.32/27".parse().unwrap(),
                egress: Egress::Otterd,
            },
        ],
        dns: vec![DnsListener {
            bridge: IfacePattern::new("otb-a").unwrap(),
            addr: Ipv4Addr::new(172, 30, 228, 1),
        }],
        no_snat_extra: vec![],
        edge_bridges: vec![IfacePattern::new("br-edge").unwrap()],
        vip_backends: vec!["172.24.0.0/27".parse().unwrap()],
    }
}

#[test]
#[ignore = "needs root and nft"]
fn policy_tables_parse() {
    check(&policy().render());
}

#[test]
#[ignore = "needs root and nft"]
fn empty_policy_parses() {
    let p = NodePolicy {
        pairs: std::collections::BTreeSet::new(),
        host_reach: std::collections::BTreeSet::new(),
        published: std::collections::BTreeSet::new(),
        local_scopes: vec![],
        dns: vec![],
        ..policy()
    };
    check(&p.render());
}

#[test]
#[ignore = "needs root and nft"]
fn bridge_guard_parses() {
    let veths = vec![VethGuard {
        veth: "veth1a2b3c".into(),
        mac: "02:42:ac:18:00:02".parse().unwrap(),
        ip: Ipv4Addr::new(172, 24, 0, 2),
        label: "web".into(),
    }];
    check(&render_bridge_guard(
        &IfacePattern::new("otb-*").unwrap(),
        &veths,
    ));
    check(&render_bridge_guard(
        &IfacePattern::new("otb-*").unwrap(),
        &[],
    ));
}

#[test]
#[ignore = "needs root and nft"]
fn vip_table_parses() {
    let views = vec![
        VipView {
            vip: Ipv4Addr::new(172, 31, 0, 1),
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
                    addr: Ipv4Addr::new(172, 24, 0, 2),
                    remaining: Duration::from_secs(25),
                },
                Backend {
                    addr: Ipv4Addr::new(172, 24, 32, 2),
                    remaining: Duration::from_millis(1),
                },
            ],
        },
        VipView {
            vip: Ipv4Addr::new(172, 31, 0, 2),
            ports: vec![PortMap {
                proto: Proto::Tcp,
                port: 5432,
                target: 5432,
            }],
            backends: vec![],
        },
    ];
    check(&render(&views));
    check(&render(&[]));
}
