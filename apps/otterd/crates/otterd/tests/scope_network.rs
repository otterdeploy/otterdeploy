//! Workloads join their environment's scope network with the address,
//! aliases, resolver and search domain their grant names. Names resolve and
//! the VIP forwards inside the environment; another environment neither
//! resolves the names nor reaches the backend. Ignored by default; run as
//! root on a Linux host with Docker, nftables and systemd, after building
//! the responder:
//!
//! ```sh
//! cargo build -p otterd-dns
//! cargo test -p otterd --test scope_network -- --ignored --test-threads=1
//! ```
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::too_many_lines
)]

use ed25519_dalek::SigningKey;
use otterd::net::{NetConfig, NodeNet};
use otterd::{LifecycleConfig, Node, NodeError, Progress};
use otterd_engine::{DockerClient, EngineAdapter, JournalHandle, object_name};
use otterd_journal::Journal;
use otterd_proto::U53;
use otterd_proto::command::CommandResult;
use otterd_proto::envelope::PublicKey;
use otterd_proto::identity::{HostBinding, TrustedKey};
use otterd_proto::ids::{Incarnation, Sha256Hex, SlotRef};
use otterd_proto::journal::Record;
use otterd_proto::lifecycle::{GrantNetwork, GrantVip, SlotGrant};
use otterd_proto::spec::{DisconnectAction, RestartPolicy, ServiceSpec, ServiceSpecInput};
use serde_json::{Value, json};
use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

const NODE: [u8; 32] = [2; 32];
const UNIT: &str = "otterd-dns-scope-network.service";
const VIP: &str = "172.31.0.10";
const DB_IP: &str = "172.24.0.34";

fn public(seed: [u8; 32]) -> PublicKey {
    PublicKey::from_verifying_key(&SigningKey::from_bytes(&seed).verifying_key())
}

fn net_config(dir: &Path) -> NetConfig {
    NetConfig {
        state_dir: dir.join("net"),
        zone_file: dir.join("dns/zone.json"),
        dns_binary: dir.join("otterd-dns"),
        unit_dir: "/etc/systemd/system".into(),
        dns_unit: UNIT.into(),
    }
}

async fn start(dir: &Path) -> Node {
    let path = dir.join("node.journal");
    let mut j = Journal::create(&path, "test").unwrap();
    j.append(Record::Identity {
        install_id: "inst".parse().unwrap(),
        node_id: "node-sn".parse().unwrap(),
        node_epoch: U53::ONE,
        key_epoch: U53::ONE,
        identity_key_id: public(NODE).key_id(),
        cp_keys: vec![TrustedKey {
            key: public([1; 32]),
            epoch: U53::ONE,
            not_after_unix_ms: None,
        }],
        recovery_key: public([3; 32]),
        host: HostBinding {
            machine_id: "m".into(),
            product_uuid: None,
            provider: None,
        },
    })
    .unwrap();
    let incarnation = Incarnation::mint().unwrap();
    let boot = otterd_sys::host::kernel_boot_id().unwrap();
    j.append(Record::ProcessStarted {
        incarnation: incarnation.clone(),
        boot_id: boot.parse().unwrap(),
    })
    .unwrap();
    let mut d = DockerClient::new("/var/run/docker.sock", Duration::from_secs(60));
    d.negotiate().await.unwrap();
    let net = NodeNet::open(
        net_config(dir),
        Arc::new(otterd_net::cmd::System),
        otterd_journal::now_unix_ms().get(),
    )
    .unwrap();
    Node::new(
        LifecycleConfig {
            staging_root: dir.join("stage"),
            stop_grace: Duration::from_secs(5),
            boot_barrier_profile: String::new(),
            hold_bound: Duration::from_secs(600),
        },
        EngineAdapter::new(
            d,
            JournalHandle::new(j),
            boot.parse().unwrap(),
            incarnation.clone(),
            "test".into(),
        ),
        SigningKey::from_bytes(&NODE),
        incarnation,
        Progress::default(),
    )
    .with_network(net)
}

/// Environment A (`scope-a`) or B (`scope-b`).
fn place(env: char, host: u8, vip: Option<&str>) -> GrantNetwork {
    let (base, n) = if env == 'a' { (32, 1) } else { (64, 2) };
    GrantNetwork {
        scope_id: format!("scope-{env}").parse().unwrap(),
        subnet: format!("172.24.0.{base}/27"),
        address: format!("172.24.0.{}", base + host),
        resolver: format!("172.30.228.{n}"),
        zone: format!("{env}.otd.internal"),
        vip: vip.map(|v| GrantVip {
            vip_id: "vip-db".parse().unwrap(),
            address: v.into(),
        }),
    }
}

fn spec(resource: &str, container: &Value, endpoint: &Value) -> ServiceSpec {
    serde_json::from_value::<ServiceSpecInput>(json!({
        "resourceId": resource, "task": {"container": container}, "endpoint": endpoint,
    }))
    .unwrap()
    .normalize()
}

fn db_spec() -> ServiceSpec {
    spec(
        "sn-db",
        &json!({"image": {"reference": "postgres:17-alpine"},
               "env": [{"name": "POSTGRES_PASSWORD", "value": {"kind": "literal", "value": "scope-net"}}]}),
        &json!({"mode": "vip", "ports": [{"targetPort": 5432}], "aliases": ["db"]}),
    )
}

fn shell_spec(resource: &str, alias: &str) -> ServiceSpec {
    spec(
        resource,
        &json!({"image": {"reference": "busybox:1.36"}, "args": ["sleep", "3600"]}),
        &json!({"mode": "dnsrr", "aliases": [alias]}),
    )
}

fn grant(node: &Node, id: &str, resource: &str, network: GrantNetwork) -> SlotGrant {
    SlotGrant {
        grant_id: id.parse().unwrap(),
        slot: SlotRef::new(resource.parse().unwrap(), 0),
        generation: U53::ONE,
        authority_term: U53::ONE,
        node_epoch: U53::ONE,
        incarnation: node.incarnation.clone(),
        exclusive: true,
        disconnect_action: DisconnectAction::Stop,
        restart: RestartPolicy::default(),
        data_claims: vec![],
        probe_only: false,
        adopts_attempt: None,
        adopts_container: None,
        network: Some(network),
    }
}

/// Apply and return the container name.
async fn apply(node: &Node, g: &SlotGrant, s: &ServiceSpec) -> Result<String, NodeError> {
    let digest = Sha256Hex::digest(&serde_json::to_vec(s).unwrap());
    let op = format!("op-{}", g.grant_id).parse().unwrap();
    match node.apply(g, s, &op, digest).await? {
        CommandResult::Applied { attempt_id, .. } => Ok(object_name(&g.slot, &attempt_id)),
        other => panic!("apply: {other:?}"),
    }
}

/// Apply a grant that must be refused; the refusal.
async fn bad(node: &Node, g: SlotGrant) -> String {
    let s = shell_spec(g.slot.resource_id.as_str(), "x");
    refused(apply(node, &g, &s).await)
}

fn refused(r: Result<String, NodeError>) -> String {
    match r {
        Err(NodeError::Refused(m)) => m,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

fn run(program: &str, args: &[&str]) -> (bool, String) {
    let out = Command::new(program).args(args).output().unwrap();
    let text =
        String::from_utf8_lossy(&out.stdout).into_owned() + &String::from_utf8_lossy(&out.stderr);
    (out.status.success(), text.trim().to_owned())
}

fn docker(args: &[&str]) -> String {
    let (ok, text) = run("docker", args);
    assert!(ok, "docker {args:?}: {text}");
    text
}

/// What the C library resolver inside a container makes of `name` (the
/// path applications take): `ping` prints the address before sending.
fn resolve(container: &str, name: &str) -> Option<String> {
    let (_, text) = run("docker", &["exec", container, "ping", "-c1", "-W1", name]);
    let rest = text.strip_prefix("PING ")?;
    let open = rest.find('(')?;
    let close = rest.find(')')?;
    rest.get(open + 1..close).map(str::to_owned)
}

/// The addresses busybox `nslookup` prints; it tries the search domain first.
fn nslookup(container: &str, name: &str, server: Option<&str>) -> Vec<String> {
    let mut args = vec!["exec", container, "nslookup", "-type=a", name];
    args.extend(server);
    let (_, text) = run("docker", &args);
    text.split("Name:")
        .skip(1)
        .flat_map(|answer| {
            answer
                .lines()
                .filter_map(|l| l.trim().strip_prefix("Address:"))
                .map(|a| a.trim().to_owned())
                .collect::<Vec<_>>()
        })
        .collect()
}

fn connects(container: &str, host: &str) -> bool {
    run(
        "docker",
        &["exec", container, "nc", "-z", "-w", "3", host, "5432"],
    )
    .0
}

fn zone(dir: &Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(dir.join("dns/zone.json")).unwrap()).unwrap()
}

fn cleanup() {
    let (_, names) = run(
        "docker",
        &["ps", "-aq", "--filter", "label=dev.otterdeploy.managed=1"],
    );
    for id in names.lines() {
        let _ = run("docker", &["rm", "-f", id]);
    }
    for n in ["otd-scope-a", "otd-scope-b", "otd-scope-x"] {
        let _ = run("docker", &["network", "rm", n]);
    }
    let _ = run("systemctl", &["disable", "--now", UNIT]);
    let _ = std::fs::remove_file(format!("/etc/systemd/system/{UNIT}"));
    let _ = run("systemctl", &["daemon-reload"]);
    let _ = run("ip", &["link", "del", "otd-dns0"]);
    for t in ["otterd_vip", "otterd_nat"] {
        let _ = run("nft", &["delete", "table", "ip", t]);
    }
}

#[tokio::test]
#[ignore = "needs root, Docker, nftables and systemd on Linux"]
async fn scope_networks_resolve_and_forward_inside_one_environment() {
    cleanup();
    let responder = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/debug/otterd-dns");
    assert!(responder.exists(), "run `cargo build -p otterd-dns` first");
    // Outside /tmp and /root: the responder unit has PrivateTmp and ProtectHome.
    let dir = tempfile::Builder::new()
        .prefix("otterd-scope-network-")
        .tempdir_in("/var/lib")
        .unwrap();
    std::fs::copy(&responder, dir.path().join("otterd-dns")).unwrap();
    let node = start(dir.path()).await;
    node.reconcile().await.unwrap();

    // Environment A: a VIP-mode Postgres and a shell; environment B: a client.
    let g_db = grant(&node, "g-db", "sn-db", place('a', 2, Some(VIP)));
    let db = apply(&node, &g_db, &db_spec()).await.unwrap();
    let g_web = grant(&node, "g-web", "sn-web", place('a', 3, None));
    let web = apply(&node, &g_web, &shell_spec("sn-web", "web"))
        .await
        .unwrap();
    let g_client = grant(&node, "g-client", "sn-client", place('b', 2, None));
    let client = apply(&node, &g_client, &shell_spec("sn-client", "client"))
        .await
        .unwrap();

    // The scope network, labelled, on its own bridge with the mesh MTU.
    let network: Value =
        serde_json::from_str(&docker(&["network", "inspect", "otd-scope-a"])).unwrap();
    let network = &network[0];
    assert_eq!(network["IPAM"]["Config"][0]["Subnet"], "172.24.0.32/27");
    assert_eq!(network["IPAM"]["Config"][0]["Gateway"], "172.24.0.33");
    assert_eq!(network["Labels"]["dev.otterdeploy.class"], "scope");
    assert_eq!(network["Labels"]["dev.otterdeploy.scope"], "scope-a");
    assert_eq!(network["Options"]["com.docker.network.driver.mtu"], "1400");
    let bridge = network["Options"]["com.docker.network.bridge.name"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(bridge.starts_with("otb-") && bridge.len() <= 15, "{bridge}");
    assert!(run("ip", &["link", "show", "dev", &bridge]).0);

    // The container: its address, resolver and search domain.
    let inspect: Value = serde_json::from_str(&docker(&["inspect", &web])).unwrap();
    let inspect = &inspect[0];
    assert_eq!(inspect["HostConfig"]["Dns"], json!(["172.30.228.1"]));
    assert_eq!(
        inspect["HostConfig"]["DnsSearch"],
        json!(["a.otd.internal"])
    );
    assert_eq!(
        inspect["NetworkSettings"]["Networks"]["otd-scope-a"]["IPAddress"],
        "172.24.0.35"
    );
    let resolv = docker(&["exec", &web, "cat", "/etc/resolv.conf"]);
    assert!(resolv.contains("search a.otd.internal"), "{resolv}");

    // The zone, the listeners and the responder.
    let zn = zone(dir.path());
    let view_a = &zn["views"]["172.30.228.1"];
    assert_eq!(view_a["zones"], json!(["a.otd.internal."]));
    assert_eq!(
        view_a["names"]["db.a.otd.internal."],
        json!({"kind": "vip", "addr": VIP})
    );
    assert_eq!(
        view_a["names"]["web.a.otd.internal."]["backends"][0]["addr"],
        "172.24.0.35"
    );
    let view_b = &zn["views"]["172.30.228.2"];
    assert!(view_b["names"].get("db.a.otd.internal.").is_none());
    assert_eq!(zn["managed"], json!(["otd.internal."]));
    let link = run("ip", &["-o", "-4", "addr", "show", "dev", "otd-dns0"]).1;
    assert!(link.contains("172.30.228.1/32") && link.contains("172.30.228.2/32"));
    assert!(run("systemctl", &["is-active", "--quiet", UNIT]).0);

    for _ in 0..60 {
        if run("docker", &["exec", &db, "pg_isready", "-U", "postgres"]).0 {
            break;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    node.reconcile().await.unwrap();

    // Inside A. Every name goes to the environment's resolver: the short
    // name through the search domain, so it means the same on every node and
    // always answers the VIP, never a container address.
    assert_eq!(resolve(&web, "db").as_deref(), Some(VIP));
    assert_eq!(resolve(&web, "db.a.otd.internal").as_deref(), Some(VIP));
    assert_eq!(
        resolve(&web, "web.a.otd.internal").as_deref(),
        Some("172.24.0.35")
    );
    // A resolver that tries the search domain first gets the VIP for the
    // short name too.
    assert_eq!(nslookup(&web, "db", None), [VIP]);
    assert!(connects(&web, "db"), "by alias");
    assert!(connects(&web, "db.a.otd.internal"), "by name");
    assert!(
        connects(&web, VIP),
        "by VIP, through the same-bridge hairpin"
    );

    // From B: its view has no A names, and the backend is not reachable.
    assert_eq!(resolve(&client, "db.a.otd.internal"), None);
    assert_eq!(resolve(&client, "db"), None);
    assert!(nslookup(&client, "db.a.otd.internal", None).is_empty());
    assert!(!connects(&client, DB_IP), "B reaches A's container");
    // The VIP from B: the receiver DNATs it, and only the Engine's filter for
    // a `nat` bridge (no unpublished port from another interface) drops the
    // forwarded flow. otterd's own pair policy, and the destination check on
    // resolver listeners, come with the firewall policy; until then B can
    // still ask A's listener directly, which this records.
    assert!(!connects(&client, VIP), "B reaches A's VIP");
    let direct = nslookup(&client, "db.a.otd.internal", Some("172.30.228.1"));
    eprintln!("B asking A's listener directly for db.a.otd.internal: {direct:?}");

    // Refused before anything is created: a bad address (the layout checks
    // are unit tested), a network of the scope's name that otterd did not
    // create, and a container adopted in place, which keeps its own network.
    let mut p = place('a', 4, None);
    p.address = "172.24.0.70".into();
    let msg = bad(&node, grant(&node, "g-bad", "sn-bad", p)).await;
    assert!(msg.contains("not a usable host"), "{msg}");
    docker(&[
        "network",
        "create",
        "--subnet",
        "172.24.0.96/27",
        "otd-scope-x",
    ]);
    let mut p = place('a', 4, None);
    p.scope_id = "scope-x".parse().unwrap();
    (p.subnet, p.address) = ("172.24.0.96/27".into(), "172.24.0.100".into());
    let msg = bad(&node, grant(&node, "g-bad", "sn-bad", p)).await;
    assert!(msg.contains("refusing to reuse"), "{msg}");
    let mut g = grant(&node, "g-adopt", "sn-adopt", place('a', 5, None));
    g.adopts_container = Some("0".repeat(64).parse().unwrap());
    let msg = bad(&node, g).await;
    assert!(msg.contains("adopted in place"), "{msg}");

    // Stopping db withdraws its backend: the VIP refuses and the name goes.
    let stopped = node
        .stop(&g_db.grant_id, "test", &"op-stop".parse().unwrap(), None)
        .await
        .unwrap();
    assert!(
        matches!(stopped, CommandResult::Stopped { .. }),
        "{stopped:?}"
    );
    assert!(
        !connects(&web, VIP),
        "the VIP still forwards to a stopped db"
    );
    let zn = zone(dir.path());
    assert!(
        zn["views"]["172.30.228.1"]["names"]
            .get("db.a.otd.internal.")
            .is_none()
    );
    // The responder picks up a new zone within a second.
    let mut gone = false;
    for _ in 0..20 {
        gone = resolve(&web, "db.a.otd.internal").is_none();
        if gone {
            break;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    assert!(gone, "db.a.otd.internal still resolves after the stop");
    let table = run("nft", &["list", "table", "ip", "otterd_vip"]).1;
    assert!(table.contains(VIP) && !table.contains(DB_IP), "{table}");

    // The last grants go: no listeners, no responder unit, no views.
    for g in [&g_web, &g_client] {
        node.stop(
            &g.grant_id,
            "test",
            &format!("op-stop-{}", g.grant_id).parse().unwrap(),
            None,
        )
        .await
        .unwrap();
    }
    node.reconcile().await.unwrap();
    assert_eq!(zone(dir.path())["views"], json!({}));
    assert!(!run("systemctl", &["is-active", "--quiet", UNIT]).0);
    let link = run("ip", &["-o", "-4", "addr", "show", "dev", "otd-dns0"]).1;
    assert!(!link.contains("172.30.228."), "{link}");
    cleanup();
}
