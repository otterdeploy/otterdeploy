//! Slot reports carry what the Engine last said about each attempt's
//! process, and since when. The Engine is reached through a local relay that
//! can forward, stall (answer `/_ping` only) or drop requests, so one node
//! sees every case. Ignored by default; run as root on a Linux host with
//! Docker:
//!
//! ```sh
//! cargo test -p otterd --test process_reports -- --ignored --test-threads=1
//! ```
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::too_many_lines
)]

use ed25519_dalek::SigningKey;
use otterd::{LifecycleConfig, Node, Progress};
use otterd_engine::{DockerClient, EngineAdapter, JournalHandle};
use otterd_journal::Journal;
use otterd_proto::U53;
use otterd_proto::command::CommandResult;
use otterd_proto::envelope::PublicKey;
use otterd_proto::identity::{HostBinding, TrustedKey};
use otterd_proto::ids::{GrantId, Incarnation, Sha256Hex, SlotRef};
use otterd_proto::journal::Record;
use otterd_proto::lifecycle::{
    AttemptReport, GrantState, ProcessObservation, SlotGrant, StopCertificate,
};
use otterd_proto::spec::{DisconnectAction, RestartPolicy, ServiceSpec, ServiceSpecInput};
use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use std::sync::atomic::{AtomicU8, Ordering};
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{UnixListener, UnixStream};

const NODE: [u8; 32] = [2; 32];
const DOCKER: &str = "/var/run/docker.sock";
const FORWARD: u8 = 0;
const STALL: u8 = 1;
const DROP: u8 = 2;
const TIMEOUT: Duration = Duration::from_secs(2);

fn public(seed: [u8; 32]) -> PublicKey {
    PublicKey::from_verifying_key(&SigningKey::from_bytes(&seed).verifying_key())
}

/// A relay in front of the Engine socket whose behaviour can be switched.
fn relay(path: &Path) -> Arc<AtomicU8> {
    let mode = Arc::new(AtomicU8::new(FORWARD));
    let listener = UnixListener::bind(path).unwrap();
    let m = Arc::clone(&mode);
    tokio::spawn(async move {
        loop {
            let Ok((mut client, _)) = listener.accept().await else {
                return;
            };
            let mode = m.load(Ordering::SeqCst);
            tokio::spawn(async move {
                match mode {
                    FORWARD => {
                        let mut engine = UnixStream::connect(DOCKER).await.unwrap();
                        let _ = tokio::io::copy_bidirectional(&mut client, &mut engine).await;
                    }
                    STALL => {
                        let mut buf = vec![0_u8; 8192];
                        let n = client.read(&mut buf).await.unwrap_or(0);
                        if String::from_utf8_lossy(&buf[..n]).contains("/_ping") {
                            let _ = client
                                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK")
                                .await;
                        } else {
                            tokio::time::sleep(Duration::from_secs(3600)).await;
                        }
                    }
                    _ => drop(client),
                }
            });
        }
    });
    mode
}

async fn start(dir: &Path, socket: &Path) -> Node {
    let path = dir.join("node.journal");
    let mut j = Journal::create(&path, "test").unwrap();
    j.append(Record::Identity {
        install_id: "inst".parse().unwrap(),
        node_id: "node-pr".parse().unwrap(),
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
    let mut d = DockerClient::new(socket, TIMEOUT);
    d.negotiate().await.unwrap();
    Node::new(
        LifecycleConfig {
            staging_root: dir.join("stage"),
            stop_grace: Duration::from_secs(5),
            boot_barrier_profile: String::new(),
            hold_bound: Duration::from_secs(300),
            pull_timeout: Duration::from_secs(600),
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
}

fn spec(resource: &str) -> ServiceSpec {
    serde_json::from_value::<ServiceSpecInput>(serde_json::json!({
        "resourceId": resource,
        "task": {"container": {"image": {"reference": "busybox:1.36"},
            "args": ["sleep", "3600"], "stopGraceMs": 1000}}
    }))
    .unwrap()
    .normalize()
}

fn grant(node: &Node, id: &str, resource: &str) -> SlotGrant {
    SlotGrant {
        grant_id: id.parse().unwrap(),
        slot: SlotRef::new(resource.parse().unwrap(), 0),
        generation: U53::ONE,
        authority_term: U53::ONE,
        node_epoch: U53::ONE,
        incarnation: node.incarnation.clone(),
        exclusive: true,
        disconnect_action: DisconnectAction::ContinueExisting,
        restart: RestartPolicy::default(),
        data_claims: vec![],
        probe_only: false,
        adopts_attempt: None,
        adopts_container: None,
        network: None,
    }
}

async fn apply(node: &Node, g: &SlotGrant, s: &ServiceSpec) {
    let digest = Sha256Hex::digest(&serde_json::to_vec(s).unwrap());
    let r = node
        .apply(g, s, &format!("op-{}", g.grant_id).parse().unwrap(), digest)
        .await
        .unwrap();
    assert!(matches!(r, CommandResult::Applied { .. }), "{r:?}");
}

/// The single attempt reported for a grant.
fn attempt(node: &Node, grant: &str) -> (GrantState, AttemptReport) {
    let id: GrantId = grant.parse().unwrap();
    let r = node
        .slot_reports()
        .unwrap()
        .into_iter()
        .find(|s| s.grant_id == id)
        .unwrap();
    assert_eq!(r.attempts.len(), 1);
    (r.state, r.attempts[0].clone())
}

fn docker(args: &[&str]) -> String {
    let out = Command::new("docker").args(args).output().unwrap();
    String::from_utf8_lossy(&out.stdout).trim().to_owned()
}

fn cleanup() {
    for r in ["pr-a", "pr-b"] {
        let ids = docker(&[
            "ps",
            "-aq",
            "--filter",
            &format!("label=dev.otterdeploy.slot={r}#0"),
        ]);
        for c in ids.split_whitespace() {
            docker(&["rm", "-f", c]);
        }
    }
}

#[tokio::test]
#[ignore = "needs root and Docker on Linux"]
async fn slot_reports_carry_the_engines_answer() {
    cleanup();
    let dir = tempfile::tempdir().unwrap();
    let mode = relay(&dir.path().join("engine.sock"));
    let node = start(dir.path(), &dir.path().join("engine.sock")).await;
    node.reconcile().await.unwrap();
    apply(&node, &grant(&node, "g-a", "pr-a"), &spec("pr-a")).await;
    apply(&node, &grant(&node, "g-b", "pr-b"), &spec("pr-b")).await;

    // Running, with the Engine's pid, straight after apply.
    let (state, a) = attempt(&node, "g-a");
    assert_eq!(state, GrantState::Running);
    let container = a.container.clone().unwrap();
    let pid: u32 = docker(&["inspect", "-f", "{{.State.Pid}}", container.as_str()])
        .parse()
        .unwrap();
    assert_eq!(a.process, ProcessObservation::Running { pid });
    let since = a.observed_since_unix_ms.unwrap();

    // An unchanged pass keeps the report identical.
    let before = node.slot_reports().unwrap();
    node.reconcile().await.unwrap();
    assert_eq!(node.slot_reports().unwrap(), before);

    // Killed outside otterd: the next pass reports the exit.
    docker(&["kill", container.as_str()]);
    node.reconcile().await.unwrap();
    let (_, a) = attempt(&node, "g-a");
    assert_eq!(a.process, ProcessObservation::Exited { exit_code: 137 });
    let exited_since = a.observed_since_unix_ms.unwrap();
    assert!(exited_since >= since);

    // Removed outside otterd: workload.inspect observes before answering.
    docker(&["rm", "-f", container.as_str()]);
    node.observe().await;
    let (_, a) = attempt(&node, "g-a");
    assert_eq!(a.process, ProcessObservation::Absent);

    // An Engine that answers `/_ping` but stalls every inspect: the pass
    // costs one timeout, not one per container, and nothing stays Running.
    mode.store(STALL, Ordering::SeqCst);
    let t = Instant::now();
    node.reconcile().await.unwrap();
    assert!(t.elapsed() < TIMEOUT * 2, "pass took {:?}", t.elapsed());
    for g in ["g-a", "g-b"] {
        let (_, a) = attempt(&node, g);
        assert!(
            matches!(&a.process, ProcessObservation::Unknown { .. }),
            "{g}: {:?}",
            a.process
        );
    }

    // An Engine that cannot be reached at all.
    mode.store(DROP, Ordering::SeqCst);
    node.reconcile().await.unwrap();
    let (_, b) = attempt(&node, "g-b");
    assert_eq!(
        b.process,
        ProcessObservation::Unknown {
            reason: "engine unreachable".into()
        }
    );

    // Back: observed again, with a new since.
    mode.store(FORWARD, Ordering::SeqCst);
    node.reconcile().await.unwrap();
    let (_, b) = attempt(&node, "g-b");
    assert!(
        matches!(b.process, ProcessObservation::Running { .. }),
        "{:?}",
        b.process
    );
    assert!(b.observed_since_unix_ms.unwrap() >= exited_since);

    // Released: the report keeps the certificate's final observation.
    let r = node
        .stop(
            &"g-b".parse().unwrap(),
            "moved",
            &"op-stop-b".parse().unwrap(),
            None,
        )
        .await
        .unwrap();
    let CommandResult::Stopped { certificate } = r else {
        panic!("{r:?}");
    };
    let cert: StopCertificate = certificate.decode_own_payload().unwrap();
    let (state, b) = attempt(&node, "g-b");
    assert_eq!(state, GrantState::Released);
    assert_eq!(b.process, cert.containers[0].process);
    assert_eq!(b.observed_since_unix_ms, Some(cert.issued_at_unix_ms));
    cleanup();
}
