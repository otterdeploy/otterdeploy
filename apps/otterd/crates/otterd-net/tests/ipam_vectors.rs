//! Parity vectors for the fleet address plan.
//!
//! The control plane allocates scopes, scope networks, endpoint addresses and
//! VIPs with a port of [`AddressPlan`]. This test replays one fixed script of
//! operations against the Rust plan and records, for every step, the result
//! (or the error kind and message) and the whole plan afterwards. A port must
//! reproduce `fixtures/ipam-vectors.json` exactly. Run with
//! `OTTERD_NET_BLESS=1` to rewrite the file after an intended change.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use otterd_net::Ipv4Net;
use otterd_net::ipam::{AddressPlan, IpamError, Layout, MeshGeneration, usable_endpoints};
use otterd_proto::ids::{NodeId, ScopeId, VipId};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::path::PathBuf;

fn node(s: &str) -> NodeId {
    s.parse().unwrap()
}

fn scope(s: &str) -> ScopeId {
    s.parse().unwrap()
}

fn vip(s: &str) -> VipId {
    s.parse().unwrap()
}

fn peers(ids: &[&str]) -> BTreeSet<NodeId> {
    ids.iter().map(|s| node(s)).collect()
}

/// The error's variant name, stable across message wording changes.
fn kind(e: &IpamError) -> String {
    let debug = format!("{e:?}");
    debug
        .split(|c: char| !c.is_ascii_alphanumeric())
        .next()
        .unwrap_or_default()
        .to_owned()
}

struct Script {
    plan: AddressPlan,
    steps: Vec<Value>,
}

impl Script {
    fn record<T: Serialize>(&mut self, op: &Value, result: Result<T, IpamError>) {
        let result = match result {
            Ok(v) => json!({"ok": v}),
            Err(e) => json!({"err": {"kind": kind(&e), "message": e.to_string()}}),
        };
        self.steps
            .push(json!({"op": op, "result": result, "plan": self.plan}));
    }

    fn enroll(&mut self, n: &str) {
        let r = self.plan.enroll_node(node(n));
        self.record(&json!({"op": "enrollNode", "node": n}), r);
    }

    fn remove_node(&mut self, n: &str, p: &[&str]) {
        let r = self.plan.remove_node(&node(n), &peers(p));
        self.record(
            &json!({"op": "removeNode", "node": n, "forwardingPeers": p}),
            r,
        );
    }

    fn scope(&mut self, s: &str, n: &str, len: u8) {
        let r = self.plan.allocate_scope(scope(s), &node(n), len);
        self.record(
            &json!({"op": "allocateScope", "scope": s, "node": n, "len": len}),
            r,
        );
    }

    fn release_scope(&mut self, s: &str, n: &str, p: &[&str]) {
        let r = self.plan.release_scope(&scope(s), &node(n), &peers(p));
        self.record(
            &json!({"op": "releaseScope", "scope": s, "node": n, "forwardingPeers": p}),
            r,
        );
    }

    fn endpoint(&mut self, s: &str, n: &str) -> Option<std::net::Ipv4Addr> {
        let r = self.plan.allocate_endpoint(&scope(s), &node(n));
        let addr = r.as_ref().ok().copied();
        self.record(&json!({"op": "allocateEndpoint", "scope": s, "node": n}), r);
        addr
    }

    fn release_endpoint(&mut self, addr: std::net::Ipv4Addr, p: &[&str]) -> Option<u64> {
        let r = self.plan.release_endpoint(addr, &peers(p));
        let id = r.as_ref().ok().copied().flatten();
        self.record(
            &json!({"op": "releaseEndpoint", "address": addr, "forwardingPeers": p}),
            r,
        );
        id
    }

    fn vip(&mut self, v: &str) {
        let r = self.plan.allocate_vip(vip(v));
        self.record(&json!({"op": "allocateVip", "vip": v}), r);
    }

    fn retire_vip(&mut self, v: &str) {
        let r: Result<_, IpamError> = Ok(self.plan.retire_vip(&vip(v)));
        self.record(&json!({"op": "retireVip", "vip": v}), r);
    }

    fn acknowledge(&mut self, id: u64, peer: &str) {
        let r = self.plan.acknowledge(id, &node(peer));
        self.record(&json!({"op": "acknowledge", "id": id, "peer": peer}), r);
    }

    fn fenced(&mut self, peer: &str) {
        let r: Result<_, IpamError> = Ok(self.plan.peer_fenced(&node(peer)));
        self.record(&json!({"op": "peerFenced", "peer": peer}), r);
    }

    fn external(&mut self, prefix: &str, source: &str) {
        let r = self
            .plan
            .reserve_external(prefix.parse::<Ipv4Net>().unwrap(), source);
        self.record(
            &json!({"op": "reserveExternal", "prefix": prefix, "source": source}),
            r,
        );
    }

    fn mesh(&mut self, n: &str) {
        let r: Result<_, IpamError> = Ok(json!({
            "stable": self.plan.stable_mesh_address(&node(n)),
            "a": self.plan.mesh_address(&node(n), MeshGeneration::A),
            "b": self.plan.mesh_address(&node(n), MeshGeneration::B),
        }));
        self.record(&json!({"op": "meshAddresses", "node": n}), r);
    }
}

fn vectors() -> Value {
    let layout = Layout::default();
    let mut s = Script {
        plan: AddressPlan::new(layout.clone()).unwrap(),
        steps: Vec::new(),
    };
    // Nodes and their slices.
    s.enroll("node_1");
    s.enroll("node_2");
    s.enroll("node_1");
    s.mesh("node_1");
    s.mesh("node_2");
    // Scope networks: sizes, alignment, refusals.
    s.scope("scope_prod", "node_1", 27);
    s.scope("scope_prod", "node_2", 26);
    s.scope("scope_dev", "node_1", 24);
    s.scope("scope_tiny", "node_1", 28);
    s.scope("scope_huge", "node_1", 23);
    s.scope("scope_prod", "node_1", 27);
    s.scope("scope_ghost", "node_9", 27);
    s.scope("scope_stage", "node_1", 25);
    // Endpoints: never the network, gateway or broadcast; a released address
    // is not handed out again before every peer acknowledged it.
    let first = s.endpoint("scope_prod", "node_1").unwrap();
    s.endpoint("scope_prod", "node_1");
    let held = s.release_endpoint(first, &["node_2"]).unwrap();
    s.endpoint("scope_prod", "node_1");
    s.release_endpoint(first, &["node_2"]);
    s.acknowledge(held, "node_2");
    s.acknowledge(held, "node_2");
    // Fill the /27 to the end.
    while s.endpoint("scope_prod", "node_1").is_some() {}
    s.endpoint("scope_ghost", "node_1");
    // A release with no forwarding peers frees at once.
    let local = s.endpoint("scope_prod", "node_2").unwrap();
    s.release_endpoint(local, &[]);
    s.endpoint("scope_prod", "node_2");
    // VIPs: allocated in order, never reused.
    s.vip("vip_web");
    s.vip("vip_db");
    s.vip("vip_web");
    s.retire_vip("vip_web");
    s.retire_vip("vip_web");
    s.vip("vip_web_2");
    // External prefixes.
    s.external(&layout.vip.to_string(), "operator network");
    s.external("172.24.32.0/19", "docker default pool");
    s.external("172.25.0.0/19", "vpn");
    s.enroll("node_3");
    // Scope release and peer fencing.
    s.release_scope("scope_dev", "node_1", &["node_2", "node_3"]);
    s.fenced("node_2");
    s.fenced("node_3");
    s.scope("scope_dev", "node_1", 24);
    // Node removal: the slice waits for its peers before reuse.
    s.remove_node("node_2", &["node_1", "node_3"]);
    s.enroll("node_4");
    s.fenced("node_1");
    s.fenced("node_3");
    s.enroll("node_5");
    s.remove_node("node_9", &[]);
    let sizes: Vec<Value> = (24u8..=27)
        .map(|len| json!({"len": len, "usable": usable_endpoints(len)}))
        .collect();
    json!({
        "layout": layout,
        "usableEndpoints": sizes,
        "steps": s.steps,
    })
}

/// One step per line, so a review diff shows which operation changed.
fn render(v: &Value) -> String {
    let line = |x: &Value| serde_json::to_string(x).unwrap();
    let steps: Vec<String> = v["steps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| format!("    {}", line(s)))
        .collect();
    format!(
        "{{\n  \"layout\": {},\n  \"usableEndpoints\": {},\n  \"steps\": [\n{}\n  ]\n}}\n",
        line(&v["layout"]),
        line(&v["usableEndpoints"]),
        steps.join(",\n")
    )
}

#[test]
fn address_plan_parity_vectors() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/ipam-vectors.json");
    let text = render(&vectors());
    if std::env::var_os("OTTERD_NET_BLESS").is_some() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &text).unwrap();
        return;
    }
    let want = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{}: {e}; run with OTTERD_NET_BLESS=1", path.display()));
    assert!(
        want == text,
        "{} is stale; run with OTTERD_NET_BLESS=1 and review the diff",
        path.display()
    );
}

#[test]
fn the_script_is_deterministic() {
    let v = vectors();
    assert_eq!(v, vectors());
    let parsed: Value = serde_json::from_str(&render(&v)).unwrap();
    assert_eq!(parsed, v, "the rendering is plain JSON");
}
