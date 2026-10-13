//! The daemon behind a real control session (TLS, handshake, bounded clock)
//! against a real Docker Engine, with an in-process control plane minting
//! capabilities. Ignored by default; run as root on a Linux host with Docker:
//!
//! ```sh
//! cargo test -p otterd --test control_session -- --ignored --test-threads=1
//! ```
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::too_many_lines
)]

use ed25519_dalek::SigningKey;
use otterd::session::{ControlHandler, NodeIdentitySource, SlotReporter};
use otterd::{LifecycleConfig, Node, Progress};
use otterd_engine::{DockerClient, EngineAdapter, JournalHandle};
use otterd_journal::Journal;
use otterd_proto::U53;
use otterd_proto::capability::{Capability, CapabilityError, Principal, PrincipalKind};
use otterd_proto::channel::{ControlFrame, RequestRefusal};
use otterd_proto::command::{Command, CommandResult, OpOutcome};
use otterd_proto::envelope::{PublicKey, SignContext, SignedEnvelope};
use otterd_proto::identity::{
    AuthorityRevocation, CpKeyTransition, CrossSigned, HostBinding, TrustedKey,
};
use otterd_proto::ids::{Incarnation, Nonce, SessionId, Sha256Hex, SlotRef};
use otterd_proto::journal::Record;
use otterd_proto::lifecycle::{SlotGrant, StopCertificate};
use otterd_proto::spec::{DisconnectAction, RestartPolicy, ServiceSpecInput};
use otterd_transport::testing::{CpSession, FakeCp};
use otterd_transport::tls::client_config;
use otterd_transport::{ConnectionManager, TransportConfig};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::watch;

const CP: [u8; 32] = [1; 32];
const NODE: [u8; 32] = [2; 32];
const RECOVERY: [u8; 32] = [3; 32];
const CP2: [u8; 32] = [4; 32];
const SEC: Duration = Duration::from_secs(1);

fn id<T: std::str::FromStr>(s: &str) -> T
where
    T::Err: std::fmt::Debug,
{
    s.parse().unwrap()
}

fn public(seed: [u8; 32]) -> PublicKey {
    PublicKey::from_verifying_key(&SigningKey::from_bytes(&seed).verifying_key())
}

async fn start_node(dir: &Path) -> Arc<Node> {
    let path = dir.join("node.journal");
    let mut j = Journal::create(&path, "test").unwrap();
    j.append(Record::Identity {
        install_id: id("inst"),
        node_id: id("node-sess"),
        node_epoch: U53::ONE,
        key_epoch: U53::ONE,
        identity_key_id: public(NODE).key_id(),
        cp_keys: vec![TrustedKey {
            key: public(CP),
            epoch: U53::ONE,
            not_after_unix_ms: None,
        }],
        recovery_key: public(RECOVERY),
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
        boot_id: id(&boot),
    })
    .unwrap();
    let mut docker = DockerClient::new("/var/run/docker.sock", Duration::from_secs(30));
    docker.negotiate().await.unwrap();
    let engine = EngineAdapter::new(
        docker,
        JournalHandle::new(j),
        id(&boot),
        incarnation.clone(),
        "test".into(),
    );
    Arc::new(Node::new(
        LifecycleConfig {
            staging_root: dir.join("stage"),
            stop_grace: Duration::from_secs(2),
            boot_barrier_profile: String::new(),
        },
        engine,
        SigningKey::from_bytes(&NODE),
        incarnation,
        Progress::default(),
    ))
}

/// The control plane mints a capability for exactly this payload, session and term.
fn request(
    signer: [u8; 32],
    session: &SessionId,
    req_id: u32,
    op: &str,
    epoch: u64,
    command: &Command,
) -> ControlFrame {
    let payload = serde_json::to_string(command).unwrap();
    let now = otterd_journal::now_unix_ms();
    let verb = command.verb();
    let cap = Capability {
        install_id: id("inst"),
        org_id: None,
        principal: Principal {
            kind: PrincipalKind::System,
            id: "scheduler".into(),
        },
        aud: id("node-sess"),
        node_epoch: U53::ONE,
        authority_term: U53::ONE,
        verb,
        resource_id: Some(id("svc-sess")),
        binding: None,
        path_root: None,
        volume: None,
        operation_epoch: U53::new(epoch).unwrap(),
        op_id: id(op),
        payload_hash: Sha256Hex::digest(payload.as_bytes()),
        nonce: Nonce::random().unwrap(),
        session_id: session.clone(),
        not_before_unix_ms: now.saturating_sub(5_000),
        expires_at_unix_ms: now.saturating_add(30_000),
        max_bytes: None,
        permissions: verb.required().to_vec(),
    };
    ControlFrame::Request {
        id: req_id,
        capability: SignedEnvelope::sign(
            &SigningKey::from_bytes(&signer),
            SignContext::Capability,
            &cap,
        )
        .unwrap(),
        payload,
    }
}

fn grant(node: &Node, grant_id: &str, generation: u64) -> SlotGrant {
    SlotGrant {
        grant_id: id(grant_id),
        slot: SlotRef::new(id("svc-sess"), 0),
        generation: U53::new(generation).unwrap(),
        authority_term: U53::ONE,
        node_epoch: U53::ONE,
        incarnation: node.incarnation.clone(),
        exclusive: true,
        disconnect_action: DisconnectAction::Stop,
        restart: RestartPolicy::default(),
        data_claims: vec![],
        probe_only: false,
    }
}

fn apply(node: &Node, grant_id: &str, generation: u64) -> Command {
    Command::WorkloadApply {
        grant: grant(node, grant_id, generation),
        spec: serde_json::from_value::<ServiceSpecInput>(serde_json::json!({
            "resourceId": "svc-sess",
            "task": {"container": {"image": {"reference": "busybox:1.36"},
                "args": ["sleep", "3600"], "stopGraceMs": 1000}}
        }))
        .unwrap()
        .normalize(),
    }
}

fn remove_leftovers() {
    let out = std::process::Command::new("docker")
        .args([
            "ps",
            "-aq",
            "--filter",
            "label=dev.otterdeploy.slot=svc-sess#0",
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

async fn response(s: &mut CpSession, want: u32) -> ControlFrame {
    loop {
        let f = s.recv_within(30 * SEC).await.expect("a frame");
        match &f {
            ControlFrame::Response { id, .. } | ControlFrame::RequestRefused { id, .. }
                if *id == want =>
            {
                return f;
            }
            _ => {}
        }
    }
}

fn completed(f: ControlFrame) -> CommandResult {
    match f {
        ControlFrame::Response {
            outcome: OpOutcome::Completed { result },
            ..
        } => result,
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
#[ignore = "needs root and Docker on Linux"]
async fn commands_reports_key_transition_and_revocation_over_a_session() {
    remove_leftovers();
    let dir = tempfile::tempdir().unwrap();
    let node = start_node(dir.path()).await;
    let mut cp = FakeCp::start(SigningKey::from_bytes(&CP), public(NODE))
        .await
        .unwrap();
    cp.set(|b| b.features = vec![otterd_proto::version::Feature::KeyRotation]);
    let mut cfg = TransportConfig::new(cp.url.clone(), client_config(&cp.trust).unwrap());
    cfg.ping_interval = Duration::from_millis(200);
    cfg.backoff_min = Duration::from_millis(50);
    cfg.backoff_max = Duration::from_millis(200);
    let reporter = SlotReporter::default();
    let manager = Arc::new(ConnectionManager::new(
        cfg,
        Arc::new(ControlHandler::new(Arc::clone(&node), reporter.clone())),
        Arc::new(NodeIdentitySource::new(Arc::clone(&node), "test")),
    ));
    let outbox = manager.outbox();
    let (shutdown, rx) = watch::channel(false);
    let m = Arc::clone(&manager);
    let task = tokio::spawn(async move { m.run(rx).await });

    let mut s = cp.session(10 * SEC).await.expect("session");
    assert_eq!(s.hello.node_id.as_str(), "node-sess");
    assert!(matches!(
        s.recv_within(SEC).await,
        Some(ControlFrame::SlotReports { ref slots, .. }) if slots.is_empty()
    ));

    // Apply over the session; the next reconcile pass reports the slot.
    let sid = s.session_id.clone();
    s.send(&request(CP, &sid, 1, "op-a1", 1, &apply(&node, "g1", 1)))
        .await;
    let CommandResult::Applied { attempt_id, .. } = completed(response(&mut s, 1).await) else {
        panic!("not applied")
    };
    node.reconcile().await.unwrap();
    reporter.after_pass(&node, &outbox);
    match s.recv_within(5 * SEC).await {
        Some(ControlFrame::SlotReports { slots, seq, .. }) => {
            assert_eq!(slots.len(), 1);
            assert!(seq.get() >= 2);
        }
        other => panic!("{other:?}"),
    }
    reporter.after_pass(&node, &outbox);
    assert!(
        s.recv_within(Duration::from_millis(500)).await.is_none(),
        "no report without a change"
    );

    // A capability from another session is refused, and so is a replay.
    let other: SessionId = id("sess-other");
    s.send(&request(
        CP,
        &other,
        2,
        "op-x",
        1,
        &Command::WorkloadInspect {
            resource_id: None,
            grant_ids: vec![],
        },
    ))
    .await;
    assert!(matches!(
        response(&mut s, 2).await,
        ControlFrame::RequestRefused {
            error: RequestRefusal::Capability {
                error: CapabilityError::WrongSession
            },
            ..
        }
    ));

    // The control plane rotates its signing key: cross-signed, journalled, acknowledged.
    let now = otterd_journal::now_unix_ms();
    let t = CpKeyTransition {
        install_id: id("inst"),
        from_key_id: public(CP).key_id(),
        to: TrustedKey {
            key: public(CP2),
            epoch: U53::from_const(2),
            not_after_unix_ms: None,
        },
        old_valid_until_unix_ms: now.saturating_add(60_000),
    };
    s.send(&ControlFrame::CpKeyTransition {
        transition: CrossSigned {
            by_old: SignedEnvelope::sign(
                &SigningKey::from_bytes(&CP),
                SignContext::CpKeyTransition,
                &t,
            )
            .unwrap(),
            by_new: SignedEnvelope::sign(
                &SigningKey::from_bytes(&CP2),
                SignContext::CpKeyTransition,
                &t,
            )
            .unwrap(),
        },
    })
    .await;
    match s.recv_within(5 * SEC).await {
        Some(ControlFrame::CpKeyTransitionAck { key_id, epoch }) => {
            assert_eq!((key_id, epoch), (public(CP2).key_id(), U53::from_const(2)));
        }
        other => panic!("{other:?}"),
    }
    let keys = node
        .engine
        .journal()
        .snapshot()
        .unwrap()
        .identity
        .unwrap()
        .cp_keys;
    assert_eq!(keys.len(), 2);

    // The new key now authorizes the stop; the certificate verifies.
    s.send(&request(
        CP2,
        &sid,
        3,
        "op-s1",
        2,
        &Command::WorkloadStop {
            grant_id: id("g1"),
            reason: "rollout".into(),
            stop_grace_ms: Some(U53::from_const(1000)),
        },
    ))
    .await;
    let CommandResult::Stopped { certificate } = completed(response(&mut s, 3).await) else {
        panic!("not stopped")
    };
    let cert: StopCertificate = certificate
        .verify(&[public(NODE)], SignContext::StopCertificate)
        .unwrap();
    assert!(cert.cgroups_empty);
    let ps = std::process::Command::new("docker")
        .args([
            "ps",
            "-aq",
            "--filter",
            &format!("label=dev.otterdeploy.attempt={attempt_id}"),
        ])
        .output()
        .unwrap();
    assert!(ps.stdout.is_empty(), "container removed");

    // The recovery key revokes authority below term 2: this session's term-1
    // capabilities stop working.
    let revocation = AuthorityRevocation {
        install_id: id("inst"),
        below_term: U53::from_const(2),
        nodes: vec![],
        issued_at_unix_ms: now,
        reason: "restored from backup".into(),
    };
    s.send(&ControlFrame::Authority {
        document: SignedEnvelope::sign(
            &SigningKey::from_bytes(&RECOVERY),
            SignContext::AuthorityRevoke,
            &revocation,
        )
        .unwrap(),
    })
    .await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    s.send(&request(CP2, &sid, 4, "op-a2", 3, &apply(&node, "g2", 2)))
        .await;
    assert!(matches!(
        response(&mut s, 4).await,
        ControlFrame::RequestRefused {
            error: RequestRefusal::Capability { .. },
            ..
        }
    ));

    // The control plane drops the session: the node reconnects with a new one,
    // and a capability for the old session is refused there.
    s.close().await;
    let mut s2 = cp.session(10 * SEC).await.expect("second session");
    assert_ne!(s2.session_id, sid);
    assert!(matches!(
        s2.recv_within(SEC).await,
        Some(ControlFrame::SlotReports { .. })
    ));
    s2.send(&request(
        CP2,
        &sid,
        5,
        "op-i",
        3,
        &Command::WorkloadInspect {
            resource_id: None,
            grant_ids: vec![],
        },
    ))
    .await;
    assert!(matches!(
        response(&mut s2, 5).await,
        ControlFrame::RequestRefused {
            error: RequestRefusal::Capability {
                error: CapabilityError::WrongSession
            },
            ..
        }
    ));

    shutdown.send(true).unwrap();
    tokio::time::timeout(5 * SEC, task).await.unwrap().unwrap();
    remove_leftovers();
}
