//! A container started outside otterd (plain Docker) is adopted in place:
//! same container, never restarted, then given back with its restart policy
//! restored, or stopped with a certificate. Ignored by default; run as root
//! on a Linux host with Docker:
//!
//! ```sh
//! cargo test -p otterd --test adopt_container -- --ignored --test-threads=1
//! ```
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::too_many_lines
)]

use ed25519_dalek::SigningKey;
use otterd::{LifecycleConfig, Node, NodeError, Progress};
use otterd_engine::{DockerClient, EngineAdapter, JournalHandle};
use otterd_journal::Journal;
use otterd_proto::U53;
use otterd_proto::command::CommandResult;
use otterd_proto::envelope::{PublicKey, SignContext};
use otterd_proto::identity::{HostBinding, TrustedKey};
use otterd_proto::ids::{AttemptId, ContainerRef, GrantId, Incarnation, Sha256Hex, SlotRef};
use otterd_proto::journal::Record;
use otterd_proto::lifecycle::{
    EngineRestartPolicy, GrantState, ProcessObservation, SlotGrant, StopCertificate,
};
use otterd_proto::spec::{DisconnectAction, RestartPolicy, ServiceSpec, ServiceSpecInput};
use std::path::Path;
use std::process::Command;
use std::time::Duration;

const NODE: [u8; 32] = [2; 32];

fn public(seed: [u8; 32]) -> PublicKey {
    PublicKey::from_verifying_key(&SigningKey::from_bytes(&seed).verifying_key())
}

async fn start(dir: &Path, hold_bound: Duration) -> Node {
    let path = dir.join("node.journal");
    if !path.exists() {
        let mut j = Journal::create(&path, "test").unwrap();
        j.append(Record::Identity {
            install_id: "inst".parse().unwrap(),
            node_id: "node-hr".parse().unwrap(),
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
    }
    let (mut j, _) = Journal::open(&path).unwrap();
    let incarnation = Incarnation::mint().unwrap();
    let boot = otterd_sys::host::kernel_boot_id().unwrap();
    j.append(Record::ProcessStarted {
        incarnation: incarnation.clone(),
        boot_id: boot.parse().unwrap(),
    })
    .unwrap();
    let mut d = DockerClient::new("/var/run/docker.sock", Duration::from_secs(60));
    d.negotiate().await.unwrap();
    Node::new(
        LifecycleConfig {
            staging_root: dir.join("stage"),
            stop_grace: Duration::from_secs(5),
            boot_barrier_profile: String::new(),
            hold_bound,
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
        "task": {"container": {"image": {"reference": "postgres:17-alpine"}}}
    }))
    .unwrap()
    .normalize()
}

fn grant(
    node: &Node,
    id: &str,
    resource: &str,
    generation: u64,
    container: Option<&str>,
    attempt: Option<&AttemptId>,
) -> SlotGrant {
    SlotGrant {
        grant_id: id.parse().unwrap(),
        slot: SlotRef::new(resource.parse().unwrap(), 0),
        generation: U53::new(generation).unwrap(),
        authority_term: U53::ONE,
        node_epoch: U53::ONE,
        incarnation: node.incarnation.clone(),
        exclusive: true,
        disconnect_action: DisconnectAction::ContinueExisting,
        restart: RestartPolicy::default(),
        data_claims: vec![],
        probe_only: false,
        adopts_attempt: attempt.cloned(),
        adopts_container: container.map(|c| c.parse().unwrap()),
    }
}

async fn apply(node: &Node, g: &SlotGrant) -> Result<CommandResult, NodeError> {
    let s = spec(g.slot.resource_id.as_str());
    let digest = Sha256Hex::digest(&serde_json::to_vec(&s).unwrap());
    node.apply(
        g,
        &s,
        &format!("op-{}", g.grant_id).parse().unwrap(),
        digest,
    )
    .await
}

fn docker(args: &[&str]) -> String {
    let out = Command::new("docker").args(args).output().unwrap();
    assert!(
        out.status.success(),
        "docker {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_owned()
}

/// `(StartedAt, status, restart policy)` of a container.
fn state_of(id: &str) -> (String, String, String) {
    let f = docker(&[
        "inspect",
        "-f",
        "{{.State.StartedAt}} {{.State.Status}} {{.HostConfig.RestartPolicy.Name}}",
        id,
    ]);
    let p: Vec<&str> = f.split(' ').collect();
    (p[0].to_owned(), p[1].to_owned(), p[2].to_owned())
}

/// A Postgres started the way the legacy runtime starts one.
fn legacy_postgres(name: &str) -> String {
    let _ = Command::new("docker").args(["rm", "-f", name]).output();
    let id = docker(&[
        "run",
        "-d",
        "--name",
        name,
        "--restart",
        "unless-stopped",
        "-e",
        "POSTGRES_PASSWORD=adopt-test",
        "postgres:17-alpine",
    ]);
    for _ in 0..60 {
        let ok = Command::new("docker")
            .args(["exec", &id, "pg_isready", "-U", "postgres"])
            .status()
            .unwrap()
            .success();
        if ok {
            return id;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    panic!("legacy Postgres never became ready");
}

fn pg_ready(id: &str) -> bool {
    Command::new("docker")
        .args(["exec", id, "pg_isready", "-U", "postgres"])
        .status()
        .unwrap()
        .success()
}

fn cleanup() {
    for n in ["adopt-legacy-a", "adopt-legacy-b", "adopt-legacy-c"] {
        let _ = Command::new("docker").args(["rm", "-f", n]).output();
    }
}

fn gid(s: &str) -> GrantId {
    s.parse().unwrap()
}

fn refused(r: Result<CommandResult, NodeError>) -> String {
    match r {
        Err(NodeError::Refused(m)) => m,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[tokio::test]
#[ignore = "needs root and Docker on Linux"]
async fn a_plain_docker_container_is_adopted_in_place_then_given_back() {
    cleanup();
    let dir = tempfile::tempdir().unwrap();
    let node = start(dir.path(), Duration::from_secs(600)).await;
    node.reconcile().await.unwrap();
    let pg_a = legacy_postgres("adopt-legacy-a");
    let (started, ..) = state_of(&pg_a);

    // Refused while the restart policy is not `no`, for an unknown id, and
    // for a short id.
    let msg = refused(apply(&node, &grant(&node, "g-a", "ad-a", 1, Some(&pg_a), None)).await);
    assert!(msg.contains("restart policy"), "{msg}");
    docker(&["update", "--restart=no", &pg_a]);
    let missing = "0".repeat(64);
    let msg = refused(apply(&node, &grant(&node, "g-a", "ad-a", 1, Some(&missing), None)).await);
    assert!(msg.contains("does not exist"), "{msg}");
    let short = &pg_a[..12];
    let msg = refused(apply(&node, &grant(&node, "g-a", "ad-a", 1, Some(short), None)).await);
    assert!(msg.contains("full container id"), "{msg}");

    // Adopted: same container, same start, still serving, reported running.
    let CommandResult::Applied { attempt_id, .. } =
        apply(&node, &grant(&node, "g-a", "ad-a", 1, Some(&pg_a), None))
            .await
            .unwrap()
    else {
        panic!("not applied")
    };
    node.reconcile().await.unwrap();
    assert_eq!(
        state_of(&pg_a),
        (started.clone(), "running".into(), "no".into())
    );
    assert!(pg_ready(&pg_a));
    let report = node
        .slot_reports()
        .unwrap()
        .into_iter()
        .find(|answer| answer.grant_id == gid("g-a"))
        .unwrap();
    assert_eq!(report.state, GrantState::Running);
    let at = &report.attempts[0];
    assert_eq!(at.attempt_id, attempt_id);
    assert_eq!(
        at.container.as_ref().map(ContainerRef::as_str),
        Some(pg_a.as_str())
    );
    assert!(
        matches!(at.process, ProcessObservation::Running { .. }),
        "{:?}",
        at.process
    );

    // No other grant may take the same container.
    let msg = refused(apply(&node, &grant(&node, "g-a2", "ad-a2", 1, Some(&pg_a), None)).await);
    assert!(msg.contains("already belongs"), "{msg}");

    // Given back: still running, never restarted, restart policy restored.
    let answer = node
        .release_adoption(&gid("g-a"), &EngineRestartPolicy::UnlessStopped)
        .await
        .unwrap();
    assert!(matches!(
        &answer,
        CommandResult::AdoptionReleased { container, .. } if container.as_str() == pg_a
    ));
    assert_eq!(
        state_of(&pg_a),
        (started.clone(), "running".into(), "unless-stopped".into())
    );
    assert!(pg_ready(&pg_a));
    let state = node.engine.journal().snapshot().unwrap();
    assert!(state.grants[&gid("g-a")].is_released());
    // A retry answers the same, with no second update.
    assert_eq!(
        node.release_adoption(&gid("g-a"), &EngineRestartPolicy::UnlessStopped)
            .await
            .unwrap(),
        answer
    );

    // Another adopted container is stopped by the control plane instead:
    // certified like any otterd attempt, but kept so a rollback can start it.
    let pg_b = legacy_postgres("adopt-legacy-b");
    docker(&["update", "--restart=no", &pg_b]);
    apply(&node, &grant(&node, "g-b", "ad-b", 1, Some(&pg_b), None))
        .await
        .unwrap();
    let CommandResult::Stopped { certificate } = node
        .stop(&gid("g-b"), "migrated", &"op-stop-b".parse().unwrap(), None)
        .await
        .unwrap()
    else {
        panic!("not certified")
    };
    let cert: StopCertificate = certificate
        .verify(&[public(NODE)], SignContext::StopCertificate)
        .unwrap();
    assert_eq!(cert.containers[0].container.as_str(), pg_b);
    assert!(cert.containers[0].process.is_positively_stopped());
    assert!(cert.containers[0].retained, "the certificate says retained");
    let (_, status, _) = state_of(&pg_b);
    assert_eq!(status, "exited", "stopped, not removed");
    assert!(
        node.release_adoption(&gid("g-b"), &EngineRestartPolicy::Always)
            .await
            .is_err(),
        "a stopped adoption cannot be given back"
    );
    // otterd never starts a retained container again.
    node.reconcile().await.unwrap();
    node.reconcile().await.unwrap();
    assert_eq!(state_of(&pg_b).1, "exited");
    // Only an explicit remove deletes it, and a retry is harmless.
    assert_eq!(node.remove(&gid("g-b")).await.unwrap(), CommandResult::Done);
    let gone = Command::new("docker")
        .args(["inspect", &pg_b])
        .output()
        .unwrap();
    assert!(!gone.status.success(), "removed");
    assert_eq!(node.remove(&gid("g-b")).await.unwrap(), CommandResult::Done);
    // A grant that is not stopped cannot be removed.
    assert!(node.remove(&gid("g-a2-missing")).await.is_err());

    // Across an otterd restart an adopted container is held and paused like
    // any exclusive attempt, then adopted by the next grant: never restarted.
    let pg_c = legacy_postgres("adopt-legacy-c");
    docker(&["update", "--restart=no", &pg_c]);
    let (c_started, ..) = state_of(&pg_c);
    let CommandResult::Applied {
        attempt_id: c_attempt,
        ..
    } = apply(&node, &grant(&node, "g-c", "ad-c", 1, Some(&pg_c), None))
        .await
        .unwrap()
    else {
        panic!("not applied")
    };
    drop(node);
    let node = start(dir.path(), Duration::from_secs(600)).await;
    node.reconcile().await.unwrap();
    assert_eq!(
        state_of(&pg_c),
        (c_started.clone(), "paused".into(), "no".into())
    );
    apply(
        &node,
        &grant(&node, "g-c2", "ad-c", 2, None, Some(&c_attempt)),
    )
    .await
    .unwrap();
    assert_eq!(state_of(&pg_c), (c_started, "running".into(), "no".into()));
    assert!(pg_ready(&pg_c));
    // The adopting grant now owns the binding: a rollback gives the
    // container back from it, still running, policy restored.
    node.release_adoption(&gid("g-c2"), &EngineRestartPolicy::Always)
        .await
        .unwrap();
    let (_, status, policy) = state_of(&pg_c);
    assert_eq!((status.as_str(), policy.as_str()), ("running", "always"));
    cleanup();
}
