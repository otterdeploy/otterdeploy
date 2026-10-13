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
use otterd::keys::KeyRotator;
use otterd::session::{ControlHandler, NodeIdentitySource, SlotReporter};
use otterd::{LifecycleConfig, Node, Progress};
use otterd_engine::{DockerClient, EngineAdapter, JournalHandle};
use otterd_identity::KeyStore;
use otterd_identity::rotation::{Enrolled, verify_rotation};
use otterd_journal::Journal;
use otterd_proto::U53;
use otterd_proto::capability::{Capability, CapabilityError, Principal, PrincipalKind};
use otterd_proto::channel::{ControlFrame, RequestRefusal};
use otterd_proto::command::{Command, CommandResult, OpOutcome};
use otterd_proto::envelope::{PublicKey, SignContext, SignedEnvelope};
use otterd_proto::identity::KeyRotationAck;
use otterd_proto::identity::{
    AuthorityRevocation, CpKeyTransition, CrossSigned, EnrollCertificate, HostBinding, NodeRole,
    TrustedKey,
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

async fn start_node(dir: &Path, key: SigningKey) -> Arc<Node> {
    let path = dir.join("node.journal");
    let mut j = Journal::create(&path, "test").unwrap();
    j.append(Record::Identity {
        install_id: id("inst"),
        node_id: id("node-sess"),
        node_epoch: U53::ONE,
        key_epoch: U53::ONE,
        identity_key_id: PublicKey::from_verifying_key(&key.verifying_key()).key_id(),
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
            hold_bound: Duration::from_secs(300),
        },
        engine,
        key,
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
        adopts_attempt: None,
        adopts_container: None,
        network: None,
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
    let node = start_node(dir.path(), SigningKey::from_bytes(&NODE)).await;
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
    reporter.after_pass(&node, None, &outbox);
    match s.recv_within(5 * SEC).await {
        Some(ControlFrame::SlotReports { slots, seq, .. }) => {
            assert_eq!(slots.len(), 1);
            assert!(seq.get() >= 2);
        }
        other => panic!("{other:?}"),
    }
    reporter.after_pass(&node, None, &outbox);
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

#[tokio::test]
#[ignore = "needs root and Docker on Linux"]
async fn node_keys_rotate_over_the_session() {
    let dir = tempfile::tempdir().unwrap();
    let store = KeyStore::new(dir.path().join("keys"));
    let one = store.create().unwrap();
    let node = start_node(dir.path(), one.identity().clone()).await;
    let mut cp = FakeCp::start(SigningKey::from_bytes(&CP), one.identity_public())
        .await
        .unwrap();
    cp.set(|b| b.features = vec![otterd_proto::version::Feature::KeyRotation]);
    let mut cfg = TransportConfig::new(cp.url.clone(), client_config(&cp.trust).unwrap());
    cfg.backoff_min = Duration::from_millis(50);
    cfg.backoff_max = Duration::from_millis(200);
    let handler = Arc::new(
        ControlHandler::new(Arc::clone(&node), SlotReporter::default())
            .with_key_rotation(Arc::new(KeyRotator::new(store.clone()))),
    );
    let manager = Arc::new(ConnectionManager::new(
        cfg,
        Arc::clone(&handler),
        Arc::new(NodeIdentitySource::new(Arc::clone(&node), "test")),
    ));
    handler.attach(manager.outbox());
    let (shutdown, rx) = watch::channel(false);
    let m = Arc::clone(&manager);
    let task = tokio::spawn(async move { m.run(rx).await });

    let mut s = cp.session(10 * SEC).await.expect("session");
    assert!(matches!(
        s.recv_within(SEC).await,
        Some(ControlFrame::SlotReports { .. })
    ));
    assert_eq!(s.hello.key_epoch, U53::ONE);

    // The operator asks for a rotation: the node offers epoch 2, cross-signed.
    assert_eq!(
        handler.rotate_keys("scheduled").unwrap(),
        U53::from_const(2)
    );
    let Some(ControlFrame::KeyRotation { statement }) = s.recv_within(5 * SEC).await else {
        panic!("no rotation offered")
    };
    let one_pub = one.identity_public();
    let rotation = verify_rotation(
        &statement,
        Enrolled {
            install_id: &id("inst"),
            node_id: &id("node-sess"),
            identity: &one_pub,
            key_epoch: U53::ONE,
        },
    )
    .unwrap();
    let new_key = rotation.new_keys.identity.clone();
    assert_eq!(
        handler.rotate_keys("again").unwrap(),
        U53::from_const(2),
        "the same epoch is re-offered"
    );
    assert!(
        matches!(s.recv_within(5 * SEC).await, Some(ControlFrame::KeyRotation { statement: again }) if again == statement)
    );

    // After a restart before the acknowledgement, the same prepared keys are
    // offered again (never a fresh set the control plane has not seen).
    let resumed = KeyRotator::new(store.clone())
        .to_offer(&node)
        .unwrap()
        .expect("the prepared epoch is offered again");
    let resumed = verify_rotation(
        &resumed,
        Enrolled {
            install_id: &id("inst"),
            node_id: &id("node-sess"),
            identity: &one_pub,
            key_epoch: U53::ONE,
        },
    )
    .unwrap();
    assert_eq!(resumed.new_keys, rotation.new_keys);

    // An acknowledgement for another key changes nothing.
    let ack = |key: &PublicKey| ControlFrame::KeyRotationAck {
        ack: SignedEnvelope::sign(
            &SigningKey::from_bytes(&CP),
            SignContext::KeyRotationAck,
            &KeyRotationAck {
                install_id: id("inst"),
                node_id: id("node-sess"),
                node_epoch: U53::ONE,
                key_epoch: U53::from_const(2),
                identity_key_id: key.key_id(),
                accepted_at_unix_ms: otterd_journal::now_unix_ms(),
            },
        )
        .unwrap(),
    };
    s.send(&ack(&one_pub)).await;
    assert!(
        s.recv_within(Duration::from_millis(700)).await.is_none(),
        "session kept, no switch"
    );
    assert_eq!(store.current_epoch().unwrap(), Some(U53::ONE));

    // The real acknowledgement: journalled, activated, and the node comes back
    // proving the new key.
    cp.set(|b| b.node_key = Some(new_key.clone()));
    s.send(&ack(&new_key)).await;
    assert!(
        s.recv_within(5 * SEC).await.is_none(),
        "the old session is closed"
    );
    let s2 = cp
        .session(10 * SEC)
        .await
        .expect("a session with the new key");
    assert_eq!(s2.hello.key_epoch, U53::from_const(2));
    assert_eq!(s2.hello.identity_key_id, new_key.key_id());
    assert_eq!(store.current_epoch().unwrap(), Some(U53::from_const(2)));
    let journalled = node.engine.journal().snapshot().unwrap().identity.unwrap();
    assert_eq!(
        (journalled.key_epoch, journalled.identity_key_id),
        (U53::from_const(2), new_key.key_id())
    );
    assert_eq!(node.identity_public(), new_key);

    shutdown.send(true).unwrap();
    tokio::time::timeout(5 * SEC, task).await.unwrap().unwrap();
}

/// Serve fixed bodies by path on loopback, as a release mirror would.
fn mirror(files: Vec<(String, Vec<u8>)>) -> String {
    use std::io::{Read as _, Write as _};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!(
        "http://127.0.0.1:{}/otterd",
        listener.local_addr().unwrap().port()
    );
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut s) = stream else { continue };
            let mut buf = [0u8; 4096];
            let n = s.read(&mut buf).unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..n]).into_owned();
            let path = req.split_whitespace().nth(1).unwrap_or("/").to_owned();
            match files.iter().find(|(p, _)| format!("/otterd{p}") == path) {
                Some((_, body)) => {
                    let _ = write!(
                        s,
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = s.write_all(body);
                }
                None => {
                    let _ = s.write_all(
                        b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                    );
                }
            }
        }
    });
    base
}

#[tokio::test]
#[ignore = "needs root and Docker on Linux"]
async fn node_upgrade_stages_only_a_verified_release() {
    use otterd::upgrade::Upgrader;
    use otterd_proto::release::{ReleaseArtifact, ReleaseKey, ReleaseKeySet, ReleaseManifest};
    use otterd_proto::version::VersionRange;
    use otterd_update::{Layout, SlotInfo};
    use std::os::unix::fs::PermissionsExt as _;

    let dir = tempfile::tempdir().unwrap();
    let node = start_node(dir.path(), SigningKey::from_bytes(&NODE)).await;
    let release_key = SigningKey::from_bytes(&[5; 32]);
    let keys_path = dir.path().join("release-keys.json");
    std::fs::write(
        &keys_path,
        serde_json::to_vec(&ReleaseKeySet {
            serial: U53::ONE,
            keys: vec![ReleaseKey {
                key: PublicKey::from_verifying_key(&release_key.verifying_key()),
                not_before_unix_ms: None,
                not_after_unix_ms: None,
            }],
        })
        .unwrap(),
    )
    .unwrap();
    std::fs::set_permissions(&keys_path, std::fs::Permissions::from_mode(0o600)).unwrap();
    let layout = Layout::new(dir.path().join("lib"));
    layout
        .install(
            b"old-binary",
            SlotInfo {
                version: "1.0.0".into(),
                sha256: Sha256Hex::digest(b"old-binary"),
                protocol: VersionRange { min: 1, max: 1 },
                journal_format: 1,
            },
        )
        .unwrap();
    let arch = std::env::consts::ARCH;
    let file = |v: &str| format!("/v{v}/otterd-linux-{arch}");
    let base = mirror(vec![
        (file("1.1.0"), b"new-binary".to_vec()),
        (file("1.3.0"), b"something else".to_vec()),
    ]);
    let upgrader =
        Arc::new(Upgrader::new(Layout::new(dir.path().join("lib")), keys_path, &base).unwrap());
    let release = |v: &str, body: &[u8], protocol: u16, signer: &SigningKey| {
        SignedEnvelope::sign(
            signer,
            SignContext::ReleaseManifest,
            &ReleaseManifest {
                version: v.into(),
                artifacts: vec![ReleaseArtifact {
                    arch: arch.into(),
                    sha256: Sha256Hex::digest(body),
                    size: U53::new(u64::try_from(body.len()).unwrap()).unwrap(),
                }],
                protocol: VersionRange {
                    min: protocol,
                    max: protocol,
                },
                journal_format: 1,
                min_rollback_version: "1.0.0".into(),
                issued_at_unix_ms: otterd_journal::now_unix_ms(),
            },
        )
        .unwrap()
    };

    let mut cp = FakeCp::start(SigningKey::from_bytes(&CP), public(NODE))
        .await
        .unwrap();
    let mut cfg = TransportConfig::new(cp.url.clone(), client_config(&cp.trust).unwrap());
    cfg.backoff_min = Duration::from_millis(50);
    let handler = Arc::new(
        ControlHandler::new(Arc::clone(&node), SlotReporter::default())
            .with_upgrader(Arc::clone(&upgrader)),
    );
    let manager = Arc::new(ConnectionManager::new(
        cfg,
        handler,
        Arc::new(NodeIdentitySource::new(Arc::clone(&node), "test")),
    ));
    let (shutdown, rx) = watch::channel(false);
    let m = Arc::clone(&manager);
    let task = tokio::spawn(async move { m.run(rx).await });
    let mut s = cp.session(10 * SEC).await.expect("session");
    let sid = s.session_id.clone();
    let failed = |f: ControlFrame| {
        matches!(
            f,
            ControlFrame::Response {
                outcome: OpOutcome::Failed { .. },
                ..
            }
        )
    };
    let upgrade = |env: SignedEnvelope| Command::NodeUpgrade { release: env };

    // Unknown signer, a protocol this session does not speak, a mirror serving other bytes.
    s.send(&request(
        CP,
        &sid,
        1,
        "op-u1",
        1,
        &upgrade(release(
            "1.1.0",
            b"new-binary",
            1,
            &SigningKey::from_bytes(&[9; 32]),
        )),
    ))
    .await;
    assert!(failed(response(&mut s, 1).await));
    s.send(&request(
        CP,
        &sid,
        2,
        "op-u2",
        2,
        &upgrade(release("1.1.0", b"new-binary", 2, &release_key)),
    ))
    .await;
    assert!(failed(response(&mut s, 2).await));
    s.send(&request(
        CP,
        &sid,
        3,
        "op-u3",
        3,
        &upgrade(release("1.3.0", b"what was signed", 1, &release_key)),
    ))
    .await;
    assert!(failed(response(&mut s, 3).await));
    assert!(layout.state().unwrap().pending.is_none(), "nothing staged");

    // The real release: staged in slot b, then the daemon asks to restart.
    s.send(&request(
        CP,
        &sid,
        4,
        "op-u4",
        4,
        &upgrade(release("1.1.0", b"new-binary", 1, &release_key)),
    ))
    .await;
    let result = completed(response(&mut s, 4).await);
    assert!(
        matches!(&result, CommandResult::Document { schema, .. } if schema == "otterd/upgrade-staged/v1"),
        "{result:?}"
    );
    tokio::time::timeout(SEC, upgrader.restart_requested())
        .await
        .expect("restart requested");
    let st = layout.state().unwrap();
    assert_eq!(st.pending.as_ref().unwrap().version, "1.1.0");
    assert_eq!(
        std::fs::read(layout.binary(otterd_update::Slot::B)).unwrap(),
        b"new-binary"
    );

    shutdown.send(true).unwrap();
    tokio::time::timeout(5 * SEC, task).await.unwrap().unwrap();
}

#[tokio::test]
#[ignore = "needs root and Docker on Linux"]
async fn a_reenrollment_reconnects_so_the_session_carries_the_new_epoch() {
    let dir = tempfile::tempdir().unwrap();
    let node = start_node(dir.path(), SigningKey::from_bytes(&NODE)).await;
    let mut cp = FakeCp::start(SigningKey::from_bytes(&CP), public(NODE))
        .await
        .unwrap();
    let mut cfg = TransportConfig::new(cp.url.clone(), client_config(&cp.trust).unwrap());
    cfg.backoff_min = Duration::from_millis(50);
    cfg.backoff_max = Duration::from_millis(200);
    let manager = Arc::new(ConnectionManager::new(
        cfg,
        Arc::new(ControlHandler::new(
            Arc::clone(&node),
            SlotReporter::default(),
        )),
        Arc::new(NodeIdentitySource::new(Arc::clone(&node), "test")),
    ));
    let (shutdown, rx) = watch::channel(false);
    let m = Arc::clone(&manager);
    let task = tokio::spawn(async move { m.run(rx).await });

    let mut s = cp.session(10 * SEC).await.expect("session");
    assert_eq!(s.hello.node_epoch, U53::ONE);
    let sid = s.session_id.clone();
    let cert = EnrollCertificate {
        install_id: id("inst"),
        node_id: id("node-sess"),
        node_epoch: U53::from_const(2),
        authority_term: U53::ONE,
        roles: vec![NodeRole::Worker],
        identity_key_id: public(NODE).key_id(),
        key_epoch: U53::ONE,
        host: HostBinding {
            machine_id: "m".into(),
            product_uuid: None,
            provider: None,
        },
        cp_keys: vec![TrustedKey {
            key: public(CP),
            epoch: U53::ONE,
            not_after_unix_ms: None,
        }],
        recovery_key: public(RECOVERY),
        control_url: cp.url.clone(),
        anchor: None,
        issued_at_unix_ms: otterd_journal::now_unix_ms(),
        reason: "re-enrolled".into(),
    };
    let certificate =
        SignedEnvelope::sign(&SigningKey::from_bytes(&CP), SignContext::Enroll, &cert).unwrap();
    s.send(&request(
        CP,
        &sid,
        1,
        "op-reenroll",
        1,
        &Command::NodeReenroll { certificate },
    ))
    .await;

    // The answer arrives on the old session, then the node closes it and
    // connects again; the new handshake binds the new epoch.
    assert!(matches!(
        completed(response(&mut s, 1).await),
        CommandResult::Done
    ));
    let drained = tokio::time::timeout(10 * SEC, async { while s.recv().await.is_some() {} });
    assert!(
        drained.await.is_ok(),
        "the old session ends after the answer"
    );
    let again = cp.session(10 * SEC).await.expect("a new session");
    assert_ne!(again.session_id, sid);
    assert_eq!(again.hello.node_epoch, U53::from_const(2));

    let _ = shutdown.send(true);
    task.await.unwrap();
}
