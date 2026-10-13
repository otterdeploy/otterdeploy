//! Platform updates against a real Docker Engine: a full update to a new
//! revision; an update interrupted before the schema boundary blocks boot
//! until it is rolled back (the old control plane comes back); one
//! interrupted after the boundary is resumed forward at boot and can no longer
//! be rolled back. Ignored by default; run as root on a Linux host with Docker:
//!
//! ```sh
//! cargo test -p otterd --test platform_update -- --ignored --test-threads=1
//! ```
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::too_many_lines
)]

use ed25519_dalek::SigningKey;
use otterd::platform::{Platform, PlatformConfig, PlatformError};
use otterd_engine::{DockerClient, EngineAdapter, JournalHandle};
use otterd_journal::Journal;
use otterd_proto::U53;
use otterd_proto::envelope::{PublicKey, SignContext, SignedEnvelope};
use otterd_proto::identity::HostBinding;
use otterd_proto::ids::{Incarnation, Sha256Hex, UpdateId};
use otterd_proto::journal::{Record, UpdatePhase};
use otterd_proto::platform::PlatformBootManifest;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

const RECOVERY: [u8; 32] = [3; 32];
const NET: &str = "otterd-pu";

fn docker(args: &[&str]) -> String {
    let out = Command::new("docker").args(args).output().unwrap();
    String::from_utf8_lossy(&out.stdout).trim().to_owned()
}

fn cleanup() {
    for c in docker(&[
        "ps",
        "-aq",
        "--filter",
        "label=dev.otterdeploy.class=platform",
    ])
    .split_whitespace()
    {
        docker(&["rm", "-f", c]);
    }
    docker(&["network", "rm", NET]);
}

fn image() -> serde_json::Value {
    docker(&["pull", "-q", "busybox:1.36"]);
    let dir = "/var/lib/otterd/platform-images-test";
    std::fs::create_dir_all(dir).unwrap();
    let path = format!("{dir}/busybox.tar");
    if !Path::new(&path).exists() {
        assert!(
            Command::new("docker")
                .args(["save", "-o", &path, "busybox:1.36"])
                .status()
                .unwrap()
                .success()
        );
    }
    serde_json::json!({"reference": "busybox:1.36", "id": docker(&["image", "inspect", "-f", "{{.Id}}", "busybox:1.36"]),
        "archive": path, "archiveSha256": Sha256Hex::digest(&std::fs::read(&path).unwrap())})
}

fn http(port: u16) -> serde_json::Value {
    serde_json::json!([
        "sh",
        "-c",
        format!("mkdir -p /www && echo ok > /www/health && exec httpd -f -p {port} -h /www")
    ])
}

fn manifest(host: &HostBinding, revision: u64, previous: Option<&Sha256Hex>) -> SignedEnvelope {
    let img = image();
    let m: PlatformBootManifest = serde_json::from_value(serde_json::json!({
        "schema": 1, "installId": "inst_pu", "host": host,
        "bootstrapEpoch": 1, "manifestRevision": revision, "authorityTerm": 2,
        "previousManifestDigest": previous,
        "network": {"name": NET, "subnet": "10.253.0.0/24", "gateway": "10.253.0.1"},
        "members": [
            {"name": "pu-pg", "role": "postgres", "ip": "10.253.0.2", "image": img, "cmd": http(5432),
             "readiness": {"kind": "tcp", "port": 5432}},
            {"name": "pu-redis", "role": "redis", "ip": "10.253.0.3", "image": img, "cmd": http(6379),
             "readiness": {"kind": "tcp", "port": 6379}},
            {"name": "pu-cp", "role": "control-plane", "ip": "10.253.0.4", "image": img, "cmd": http(3000),
             "env": {"CP_REVISION": revision.to_string()}, "recoveryEnv": {"OTTERDEPLOY_RECOVERY": "1"},
             "dependsOn": ["pu-pg", "pu-redis"], "readiness": {"kind": "http", "port": 3000, "path": "/health"}}
        ]
    }))
    .unwrap();
    SignedEnvelope::sign(
        &SigningKey::from_bytes(&RECOVERY),
        SignContext::PlatformBootManifest,
        &m,
    )
    .unwrap()
}

async fn platform(dir: &Path) -> Platform {
    let path = dir.join("boot.journal");
    let journal = if path.exists() {
        Journal::open(&path).unwrap().0
    } else {
        Journal::create(&path, "test").unwrap()
    };
    let boot = otterd_sys::host::kernel_boot_id().unwrap();
    let mut d = DockerClient::new("/var/run/docker.sock", Duration::from_secs(60));
    d.negotiate().await.unwrap();
    Platform::new(
        PlatformConfig {
            dir: dir.to_owned(),
            boot_barrier_profile: String::new(),
            ready_timeout: Duration::from_secs(60),
        },
        EngineAdapter::new(
            d,
            JournalHandle::new(journal),
            boot.parse().unwrap(),
            Incarnation::mint().unwrap(),
            "test".into(),
        ),
        PublicKey::from_verifying_key(&SigningKey::from_bytes(&RECOVERY).verifying_key()),
    )
}

fn cp_revision() -> String {
    let id = docker(&[
        "ps",
        "-q",
        "--filter",
        "label=dev.otterdeploy.class=platform",
        "--filter",
        "name=pu-cp",
    ]);
    let env = docker(&["inspect", "-f", "{{json .Config.Env}}", &id]);
    env.split("CP_REVISION=")
        .nth(1)
        .and_then(|r| r.split('"').next())
        .unwrap_or("none")
        .to_owned()
}

fn running(name: &str) -> String {
    docker(&[
        "ps",
        "-q",
        "--filter",
        "label=dev.otterdeploy.class=platform",
        "--filter",
        &format!("name={name}"),
    ])
}

/// Journal an update up to `reached`, as a crash right after it would leave it.
async fn interrupted(p: &Platform, env: &SignedEnvelope, reached: UpdatePhase) {
    let (from, _) = p.active().unwrap();
    let to = p.store(env).unwrap();
    let id = UpdateId::mint().unwrap();
    for phase in [
        UpdatePhase::Staged,
        UpdatePhase::CpQuiesced,
        UpdatePhase::CpStopped,
        UpdatePhase::SchemaBoundary,
    ]
    .into_iter()
    .filter(|ph| *ph <= reached)
    {
        p.engine()
            .journal()
            .append(Record::UpdatePhaseEntered {
                update_id: id.clone(),
                phase,
                from_manifest_digest: from.clone(),
                to_manifest_digest: to.clone(),
            })
            .await
            .unwrap();
    }
    if reached >= UpdatePhase::CpStopped {
        docker(&["rm", "-f", &running("pu-cp")]);
    }
}

#[tokio::test]
#[ignore = "needs root and Docker on Linux"]
async fn update_rollback_and_resume() {
    cleanup();
    let dir = tempfile::tempdir().unwrap();
    let host = otterd_sys::host::host_binding(None).unwrap();
    let p = platform(dir.path()).await;
    let v1 = manifest(&host, 1, None);
    p.install(&v1, &host).await.unwrap();
    p.boot(&host, U53::ZERO, false).await.unwrap();
    assert_eq!(cp_revision(), "1");
    let (pg, redis) = (running("pu-pg"), running("pu-redis"));

    // Refused: not newer, not naming the active manifest, a revoked term.
    assert!(matches!(
        p.update(&manifest(&host, 1, None), &host, U53::ZERO).await,
        Err(PlatformError::Blocked(_))
    ));
    let v1_digest = v1.payload_digest().unwrap();
    assert!(
        p.update(
            &manifest(&host, 2, Some(&Sha256Hex::digest(b"other"))),
            &host,
            U53::ZERO
        )
        .await
        .is_err()
    );
    assert!(
        p.update(
            &manifest(&host, 2, Some(&v1_digest)),
            &host,
            U53::from_const(3)
        )
        .await
        .is_err()
    );

    // A full update: the control plane is replaced, the rest continues.
    let v2 = manifest(&host, 2, Some(&v1_digest));
    p.update(&v2, &host, U53::ZERO).await.unwrap();
    assert_eq!(cp_revision(), "2");
    assert_eq!(
        (running("pu-pg"), running("pu-redis")),
        (pg.clone(), redis.clone()),
        "unchanged members continue"
    );
    let state = p.engine().journal().snapshot().unwrap();
    assert_eq!(
        state.manifest.as_ref().unwrap().manifest_digest,
        v2.payload_digest().unwrap()
    );
    assert_eq!(state.update.as_ref().unwrap().phase, UpdatePhase::Committed);
    drop(p);

    // Interrupted after CpStopped (reversible): boot refuses to guess.
    let v2_digest = v2.payload_digest().unwrap();
    let v3 = manifest(&host, 3, Some(&v2_digest));
    let p = platform(dir.path()).await;
    interrupted(&p, &v3, UpdatePhase::CpStopped).await;
    drop(p);
    let p = platform(dir.path()).await;
    let r = p.boot(&host, U53::ZERO, false).await;
    assert!(
        matches!(&r, Err(PlatformError::Blocked(m)) if m.contains("roll it back or resume")),
        "{r:?}"
    );
    assert!(running("pu-cp").is_empty());
    // Roll back: the active manifest is still v2, and its control plane returns.
    p.rollback().await.unwrap();
    p.boot(&host, U53::ZERO, false).await.unwrap();
    assert_eq!(cp_revision(), "2");
    drop(p);

    // Interrupted after the schema boundary: boot resumes it forward; no rollback.
    let p = platform(dir.path()).await;
    interrupted(&p, &v3, UpdatePhase::SchemaBoundary).await;
    assert!(
        matches!(p.rollback().await, Err(PlatformError::Blocked(m)) if m.contains("schema boundary"))
    );
    drop(p);
    let p = platform(dir.path()).await;
    p.boot(&host, U53::ZERO, false).await.unwrap();
    assert_eq!(cp_revision(), "3");
    let state = p.engine().journal().snapshot().unwrap();
    assert_eq!(
        state.manifest.as_ref().unwrap().manifest_digest,
        v3.payload_digest().unwrap()
    );
    assert_eq!(state.update.as_ref().unwrap().phase, UpdatePhase::Committed);

    // A resume request carries a reversible interruption forward too.
    let v4 = manifest(&host, 4, Some(&v3.payload_digest().unwrap()));
    interrupted(&p, &v4, UpdatePhase::CpQuiesced).await;
    p.request_resume().unwrap();
    p.boot(&host, U53::ZERO, false).await.unwrap();
    assert_eq!(cp_revision(), "4");
    assert_eq!(
        (running("pu-pg"), running("pu-redis")),
        (pg, redis),
        "Postgres and Redis never restarted"
    );
    cleanup();
}

mod session {
    use super::*;
    use otterd::session::{ControlHandler, NodeIdentitySource, SlotReporter};
    use otterd::{LifecycleConfig, Node, Progress};
    use otterd_proto::capability::{Capability, Principal, PrincipalKind};
    use otterd_proto::channel::ControlFrame;
    use otterd_proto::command::{Command, CommandResult, OpOutcome};
    use otterd_proto::identity::TrustedKey;
    use otterd_proto::ids::Nonce;
    use otterd_transport::testing::{CpSession, FakeCp};
    use otterd_transport::tls::client_config;
    use otterd_transport::{ConnectionManager, TransportConfig};
    use std::sync::Arc;
    use tokio::sync::watch;

    const CP: [u8; 32] = [1; 32];
    const NODE: [u8; 32] = [2; 32];

    fn public(seed: [u8; 32]) -> PublicKey {
        PublicKey::from_verifying_key(&SigningKey::from_bytes(&seed).verifying_key())
    }

    async fn node(dir: &Path) -> Arc<Node> {
        let path = dir.join("node.journal");
        let mut j = Journal::create(&path, "test").unwrap();
        j.append(Record::Identity {
            install_id: "inst_pu".parse().unwrap(),
            node_id: "node-pu".parse().unwrap(),
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

    fn request(
        session: &otterd_proto::ids::SessionId,
        id: u32,
        op: &str,
        command: &Command,
    ) -> ControlFrame {
        let payload = serde_json::to_string(command).unwrap();
        let now = otterd_journal::now_unix_ms();
        let verb = command.verb();
        let cap = Capability {
            install_id: "inst_pu".parse().unwrap(),
            org_id: None,
            principal: Principal {
                kind: PrincipalKind::System,
                id: "platform".into(),
            },
            aud: "node-pu".parse().unwrap(),
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

    async fn answer(s: &mut CpSession, want: u32) -> OpOutcome {
        loop {
            match s
                .recv_within(Duration::from_secs(30))
                .await
                .expect("a frame")
            {
                ControlFrame::Response { id, outcome, .. } if id == want => return outcome,
                _ => {}
            }
        }
    }

    async fn session_with(
        handler: ControlHandler,
        node: &Arc<Node>,
    ) -> (FakeCp, CpSession, watch::Sender<bool>) {
        let mut cp = FakeCp::start(SigningKey::from_bytes(&CP), public(NODE))
            .await
            .unwrap();
        let cfg = TransportConfig::new(cp.url.clone(), client_config(&cp.trust).unwrap());
        let manager = Arc::new(ConnectionManager::new(
            cfg,
            Arc::new(handler),
            Arc::new(NodeIdentitySource::new(Arc::clone(node), "test")),
        ));
        let (shutdown, rx) = watch::channel(false);
        tokio::spawn(async move { manager.run(rx).await });
        let s = cp.session(Duration::from_secs(10)).await.expect("session");
        (cp, s, shutdown)
    }

    #[tokio::test]
    #[ignore = "needs root and Docker on Linux"]
    async fn the_platform_update_verb_runs_and_reports_progress() {
        cleanup();
        let dir = tempfile::tempdir().unwrap();
        let host = otterd_sys::host::host_binding(None).unwrap();
        let node = node(dir.path()).await;
        let p = Arc::new(platform(&dir.path().join("bootstrap")).await);
        let v1 = manifest(&host, 1, None);
        p.install(&v1, &host).await.unwrap();
        p.boot(&host, U53::ZERO, false).await.unwrap();

        // A node without a platform refuses the verb.
        let v2 = manifest(&host, 2, Some(&v1.payload_digest().unwrap()));
        let (_cp, mut s, stop) = session_with(
            ControlHandler::new(Arc::clone(&node), SlotReporter::default()),
            &node,
        )
        .await;
        let sid = s.session_id.clone();
        s.send(&request(
            &sid,
            1,
            "op-pu-0",
            &Command::PlatformUpdate {
                manifest: v2.clone(),
            },
        ))
        .await;
        assert!(matches!(answer(&mut s, 1).await, OpOutcome::Failed { .. }));
        stop.send(true).unwrap();

        // With the platform: answered at once, then the update runs on its own;
        // the slot reports carry its progress.
        let reporter = SlotReporter::default();
        let handler =
            ControlHandler::new(Arc::clone(&node), reporter.clone()).with_platform(Arc::clone(&p));
        let (_cp, mut s, stop) = session_with(handler, &node).await;
        match s.recv_within(Duration::from_secs(5)).await {
            Some(ControlFrame::SlotReports {
                platform: Some(r), ..
            }) => assert_eq!(r.phase, "up"),
            other => panic!("{other:?}"),
        }
        let sid = s.session_id.clone();
        s.send(&request(
            &sid,
            2,
            "op-pu-1",
            &Command::PlatformUpdate {
                manifest: v2.clone(),
            },
        ))
        .await;
        match answer(&mut s, 2).await {
            OpOutcome::Completed {
                result: CommandResult::Document { schema, body },
            } => {
                assert_eq!(schema, "otterd/platform-update-started/v1");
                assert_eq!(
                    body["manifestDigest"],
                    serde_json::json!(v2.payload_digest().unwrap())
                );
            }
            other => panic!("{other:?}"),
        }
        let deadline = std::time::Instant::now() + Duration::from_secs(240);
        loop {
            let r = p.report();
            if r.update
                .as_ref()
                .is_some_and(|u| u.phase == UpdatePhase::Committed)
            {
                assert_eq!(r.manifest_digest, Some(v2.payload_digest().unwrap()));
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "update did not commit: {r:?}"
            );
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        assert_eq!(cp_revision(), "2");
        reporter.after_pass(&node, Some(&p), &otterd_transport::Outbox::default());
        stop.send(true).unwrap();
        cleanup();
    }
}
