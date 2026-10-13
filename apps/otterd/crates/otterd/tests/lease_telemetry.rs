//! Leases and telemetry over a real control session against a real Engine.
//! Ignored by default; run as root on a Linux host with Docker:
//!
//! ```sh
//! cargo test -p otterd --test lease_telemetry -- --ignored --test-threads=1
//! ```
#![allow(
    clippy::many_single_char_names,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::too_many_lines
)]

use ed25519_dalek::SigningKey;
use otterd::lease::LeaseKeeper;
use otterd::session::{ControlHandler, NodeIdentitySource, SlotReporter};
use otterd::telemetry::Telemetry;
use otterd::{LifecycleConfig, Node, Progress};
use otterd_engine::{DockerClient, EngineAdapter, JournalHandle};
use otterd_journal::Journal;
use otterd_proto::U53;
use otterd_proto::capability::{Capability, Principal, PrincipalKind};
use otterd_proto::channel::ControlFrame;
use otterd_proto::command::{Command, CommandResult, OpOutcome};
use otterd_proto::envelope::{PublicKey, SignContext, SignedEnvelope};
use otterd_proto::health::HealthCheck;
use otterd_proto::identity::{HostBinding, TrustedKey};
use otterd_proto::ids::{GrantId, Incarnation, Nonce, SessionId, Sha256Hex, SlotRef};
use otterd_proto::journal::Record;
use otterd_proto::lifecycle::{LeaseRenewal, SlotGrant};
use otterd_proto::spec::{DisconnectAction, RestartPolicy, ServiceSpec, ServiceSpecInput};
use otterd_transport::testing::{CpSession, FakeCp};
use otterd_transport::tls::client_config;
use otterd_transport::{ConnectionManager, TransportConfig};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::watch;

const CP: [u8; 32] = [1; 32];
const NODE: [u8; 32] = [2; 32];

fn public(seed: [u8; 32]) -> PublicKey {
    PublicKey::from_verifying_key(&SigningKey::from_bytes(&seed).verifying_key())
}

async fn node(dir: &Path) -> Arc<Node> {
    let mut j = Journal::create(&dir.join("node.journal"), "test").unwrap();
    j.append(Record::Identity {
        install_id: "inst".parse().unwrap(),
        node_id: "node-lt".parse().unwrap(),
        node_epoch: U53::ONE,
        key_epoch: U53::ONE,
        identity_key_id: public(NODE).key_id(),
        cp_keys: vec![TrustedKey {
            key: public(CP),
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
    let mut d = DockerClient::new("/var/run/docker.sock", Duration::from_secs(30));
    d.negotiate().await.unwrap();
    Arc::new(Node::new(
        LifecycleConfig {
            staging_root: dir.join("stage"),
            stop_grace: Duration::from_secs(2),
            boot_barrier_profile: String::new(),
            hold_bound: Duration::from_secs(300),
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
    ))
}

fn spec(resource: &str) -> ServiceSpec {
    serde_json::from_value::<ServiceSpecInput>(serde_json::json!({
        "resourceId": resource,
        "task": {"container": {"image": {"reference": "busybox:1.36"}, "args": ["sleep", "3600"], "stopGraceMs": 1000}}
    }))
    .unwrap()
    .normalize()
}

async fn apply(node: &Node, grant: &str, resource: &str, action: DisconnectAction) {
    let g = SlotGrant {
        grant_id: grant.parse().unwrap(),
        slot: SlotRef::new(resource.parse().unwrap(), 0),
        generation: U53::ONE,
        authority_term: U53::ONE,
        node_epoch: U53::ONE,
        incarnation: node.incarnation.clone(),
        exclusive: true,
        disconnect_action: action,
        restart: RestartPolicy::default(),
        data_claims: vec![],
        probe_only: false,
        adopts_attempt: None,
        adopts_container: None,
        network: None,
    };
    let s = spec(resource);
    node.apply(
        &g,
        &s,
        &format!("op-{grant}").parse().unwrap(),
        Sha256Hex::digest(&serde_json::to_vec(&s).unwrap()),
    )
    .await
    .unwrap();
}

fn cleanup() {
    for r in ["lt-stop", "lt-keep"] {
        let out = std::process::Command::new("docker")
            .args([
                "ps",
                "-aq",
                "--filter",
                &format!("label=dev.otterdeploy.slot={r}#0"),
            ])
            .output()
            .unwrap();
        for c in String::from_utf8_lossy(&out.stdout).split_whitespace() {
            std::process::Command::new("docker")
                .args(["rm", "-f", c])
                .output()
                .unwrap();
        }
    }
}

fn renewal(
    node: &Node,
    nonce: Nonce,
    grants: Vec<GrantId>,
    ms: u64,
    signer: [u8; 32],
) -> ControlFrame {
    let r = LeaseRenewal {
        install_id: "inst".parse().unwrap(),
        node_id: "node-lt".parse().unwrap(),
        node_epoch: U53::ONE,
        authority_term: U53::ONE,
        boot_id: node.engine.boot_id().clone(),
        incarnation: node.incarnation.clone(),
        nonce,
        grants,
        duration_ms: U53::new(ms).unwrap(),
    };
    ControlFrame::Lease {
        renewal: SignedEnvelope::sign(&SigningKey::from_bytes(&signer), SignContext::Lease, &r)
            .unwrap(),
    }
}

fn request(session: &SessionId, id: u32, op: &str, command: &Command) -> ControlFrame {
    let payload = serde_json::to_string(command).unwrap();
    let now = otterd_journal::now_unix_ms();
    let verb = command.verb();
    let cap = Capability {
        install_id: "inst".parse().unwrap(),
        org_id: None,
        principal: Principal {
            kind: PrincipalKind::System,
            id: "health".into(),
        },
        aud: "node-lt".parse().unwrap(),
        node_epoch: U53::ONE,
        authority_term: U53::ONE,
        verb,
        resource_id: None,
        binding: None,
        path_root: None,
        volume: None,
        operation_epoch: U53::ONE,
        op_id: op.parse().unwrap(),
        payload_hash: Sha256Hex::digest(payload.as_bytes()),
        nonce: Nonce::random().unwrap(),
        session_id: session.clone(),
        not_before_unix_ms: now.saturating_sub(5_000),
        expires_at_unix_ms: now.saturating_add(30_000),
        max_bytes: None,
        permissions: verb.required().to_vec(),
    };
    ControlFrame::Request {
        id,
        capability: SignedEnvelope::sign(
            &SigningKey::from_bytes(&CP),
            SignContext::Capability,
            &cap,
        )
        .unwrap(),
        payload,
    }
}

async fn next(
    s: &mut CpSession,
    within: Duration,
    mut pick: impl FnMut(&ControlFrame) -> bool,
) -> ControlFrame {
    let deadline = Instant::now() + within;
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        let f = s
            .recv_within(left)
            .await
            .expect("the expected frame in time");
        if pick(&f) {
            return f;
        }
    }
}

#[tokio::test]
#[ignore = "needs root and Docker on Linux"]
async fn leases_stop_only_stop_on_disconnect_grants_and_telemetry_flows() {
    cleanup();
    let dir = tempfile::tempdir().unwrap();
    let node = node(dir.path()).await;
    apply(&node, "g-stop", "lt-stop", DisconnectAction::Stop).await;
    apply(
        &node,
        "g-keep",
        "lt-keep",
        DisconnectAction::ContinueExisting,
    )
    .await;

    let lease = Arc::new(LeaseKeeper::new());
    let mut d = DockerClient::new("/var/run/docker.sock", Duration::from_secs(10));
    d.negotiate().await.unwrap();
    let (telemetry, records) = Telemetry::start(Arc::clone(&node), d).unwrap();
    let handler = Arc::new(
        ControlHandler::new(Arc::clone(&node), SlotReporter::default())
            .with_lease(Arc::clone(&lease))
            .with_telemetry(Arc::clone(&telemetry)),
    );
    let mut cp = FakeCp::start(SigningKey::from_bytes(&CP), public(NODE))
        .await
        .unwrap();
    let mut cfg = TransportConfig::new(cp.url.clone(), client_config(&cp.trust).unwrap());
    cfg.ping_interval = Duration::from_millis(500);
    let manager = Arc::new(ConnectionManager::new(
        cfg,
        handler,
        Arc::new(NodeIdentitySource::new(Arc::clone(&node), "test")),
    ));
    let outbox = manager.outbox();
    let (shutdown, rx) = watch::channel(false);
    let m = Arc::clone(&manager);
    tokio::spawn(async move { m.run(rx).await });
    let mut s = cp.session(Duration::from_secs(10)).await.expect("session");
    tokio::spawn(Arc::clone(&telemetry).run_metrics(outbox.clone(), Duration::from_secs(1)));
    tokio::spawn(Arc::clone(&telemetry).run_probes(outbox.clone(), records));

    // Telemetry: metric rounds, with our container attributed to its resource.
    let f = next(&mut s, Duration::from_secs(15), |f| {
        matches!(f, ControlFrame::Telemetry(b) if b.metrics.iter().any(|m| m.identity.subject_id.as_str() == "lt-stop"))
    })
    .await;
    let ControlFrame::Telemetry(batch) = f else {
        panic!()
    };
    assert!(
        batch
            .metrics
            .iter()
            .any(|m| m.identity.subject_id.as_str() == "node-lt"),
        "a host sample"
    );

    // A lease request names this incarnation's grants; only the matching,
    // CP-signed answer is accepted, once.
    outbox.send(lease.request(&node).unwrap()).unwrap();
    let ControlFrame::LeaseRequest(req) = next(&mut s, Duration::from_secs(5), |f| {
        matches!(f, ControlFrame::LeaseRequest(_))
    })
    .await
    else {
        panic!()
    };
    assert_eq!(req.grants.len(), 2);
    s.send(&renewal(
        &node,
        req.nonce.clone(),
        req.grants.clone(),
        3_000,
        [9; 32],
    ))
    .await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(
        lease.status().remaining_ms.is_none(),
        "a stranger's lease is refused"
    );
    s.send(&renewal(
        &node,
        req.nonce.clone(),
        req.grants.clone(),
        3_000,
        CP,
    ))
    .await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let st = lease.status();
    assert!(
        st.remaining_ms.is_some_and(|ms| ms > 0 && ms <= 3_000),
        "{st:?}"
    );
    s.send(&renewal(&node, req.nonce, req.grants, 60_000, CP))
        .await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(
        lease.status().remaining_ms.unwrap() <= 3_000,
        "a replayed nonce extends nothing"
    );

    // Health: a TCP check against a local listener produces probe results.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for c in listener.incoming() {
            drop(c);
        }
    });
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../otterd-proto/fixtures/schemas/HealthCheck.json"
    ))
    .unwrap();
    let mut v: serde_json::Value =
        serde_json::from_str::<serde_json::Value>(&text).unwrap()["cases"][0].clone();
    v["probe"] = serde_json::json!({"kind": "tcp", "host": "127.0.0.1", "port": port});
    v["intervalMs"] = serde_json::json!(30_000);
    v["id"] = serde_json::json!("chk_lt");
    let check: HealthCheck = serde_json::from_value(v).unwrap();
    let sid = s.session_id.clone();
    s.send(&request(
        &sid,
        1,
        "op-hc",
        &Command::HealthConfigure {
            revision: U53::ONE,
            checks: vec![check],
        },
    ))
    .await;
    match next(&mut s, Duration::from_secs(10), |f| {
        matches!(f, ControlFrame::Response { id: 1, .. })
    })
    .await
    {
        ControlFrame::Response {
            outcome:
                OpOutcome::Completed {
                    result: CommandResult::Document { body, .. },
                },
            ..
        } => {
            assert_eq!(body["admitted"], serde_json::json!(["chk_lt"]), "{body}");
        }
        other => panic!("{other:?}"),
    }
    let f = next(
        &mut s,
        Duration::from_secs(75),
        |f| matches!(f, ControlFrame::Telemetry(b) if !b.probes.is_empty()),
    )
    .await;
    let ControlFrame::Telemetry(batch) = f else {
        panic!()
    };
    assert_eq!(batch.probes[0].identity.check_id.as_str(), "chk_lt");

    // The lease ran out: once the grace for the first lease has passed, the
    // stop-on-disconnect grant is stopped and certified; continue-existing keeps running.
    let deadline = Instant::now() + Duration::from_secs(40);
    loop {
        lease.enforce(&node).await;
        let state = node.engine.journal().snapshot().unwrap();
        if state.grants[&"g-stop".parse::<GrantId>().unwrap()].is_released() {
            assert!(!state.grants[&"g-keep".parse::<GrantId>().unwrap()].is_released());
            break;
        }
        assert!(
            Instant::now() < deadline,
            "the expired lease never stopped g-stop"
        );
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    assert!(telemetry.stats().batches_sent >= 2);
    shutdown.send(true).unwrap();
    cleanup();
}
