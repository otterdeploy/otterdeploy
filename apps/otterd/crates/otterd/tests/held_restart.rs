//! Across a daemon restart an earlier process's exclusive container is held
//! and paused, not stopped: the control plane adopts it (same container, no
//! restart) or stops it (certified). Unresolved work and an expired hold
//! still take the stop path. Ignored by default; run as root on a Linux host
//! with Docker:
//!
//! ```sh
//! cargo test -p otterd --test held_restart -- --ignored --test-threads=1
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
use otterd_proto::envelope::{PublicKey, SignContext};
use otterd_proto::identity::{HostBinding, TrustedKey};
use otterd_proto::ids::{AttemptId, GrantId, Incarnation, MutationId, Sha256Hex, SlotRef};
use otterd_proto::journal::{MutationRecord, Record, WorkloadClass};
use otterd_proto::lifecycle::{EngineVerb, SlotGrant, StopCertificate};
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

fn spec(resource: &str, postgres: bool) -> ServiceSpec {
    let task = if postgres {
        serde_json::json!({"container": {"image": {"reference": "postgres:17-alpine"},
            "env": [{"name": "POSTGRES_PASSWORD", "value": {"kind": "literal", "value": "held-test"}}],
            "stopGraceMs": 5000}})
    } else {
        serde_json::json!({"container": {"image": {"reference": "busybox:1.36"}, "args": ["sleep", "3600"], "stopGraceMs": 1000}})
    };
    serde_json::from_value::<ServiceSpecInput>(
        serde_json::json!({"resourceId": resource, "task": task}),
    )
    .unwrap()
    .normalize()
}

fn grant(
    node: &Node,
    id: &str,
    resource: &str,
    generation: u64,
    adopts: Option<&AttemptId>,
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
        adopts_attempt: adopts.cloned(),
    }
}

async fn apply(node: &Node, g: &SlotGrant, s: &ServiceSpec) -> AttemptId {
    let digest = Sha256Hex::digest(&serde_json::to_vec(s).unwrap());
    match node
        .apply(g, s, &format!("op-{}", g.grant_id).parse().unwrap(), digest)
        .await
        .unwrap()
    {
        CommandResult::Applied { attempt_id, .. } => attempt_id,
        other => panic!("{other:?}"),
    }
}

/// `(id, StartedAt, paused, status)` of the slot's container, if any.
fn container(resource: &str) -> Option<(String, String, bool, String)> {
    let out = Command::new("docker")
        .args([
            "ps",
            "-aq",
            "--filter",
            &format!("label=dev.otterdeploy.slot={resource}#0"),
        ])
        .output()
        .unwrap();
    let id = String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()?
        .trim()
        .to_owned();
    let f = Command::new("docker")
        .args([
            "inspect",
            "-f",
            "{{.Id}} {{.State.StartedAt}} {{.State.Paused}} {{.State.Status}}",
            &id,
        ])
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&f.stdout).trim().to_owned();
    let p: Vec<&str> = text.split(' ').collect();
    Some((
        p[0].to_owned(),
        p[1].to_owned(),
        p[2] == "true",
        p[3].to_owned(),
    ))
}

fn cleanup() {
    for r in ["hr-pg", "hr-stop", "hr-sub", "hr-bound"] {
        let out = Command::new("docker")
            .args([
                "ps",
                "-aq",
                "--filter",
                &format!("label=dev.otterdeploy.slot={r}#0"),
            ])
            .output()
            .unwrap();
        for c in String::from_utf8_lossy(&out.stdout).split_whitespace() {
            Command::new("docker")
                .args(["rm", "-f", c])
                .output()
                .unwrap();
        }
    }
}

fn gid(s: &str) -> GrantId {
    s.parse().unwrap()
}

#[tokio::test]
#[ignore = "needs root and Docker on Linux"]
async fn held_across_restart_then_adopted_or_stopped() {
    cleanup();
    let dir = tempfile::tempdir().unwrap();
    let long = Duration::from_secs(600);

    // Process A starts Postgres (exclusive) and two busybox workloads.
    let a = start(dir.path(), long).await;
    let pg_attempt = apply(
        &a,
        &grant(&a, "g-pg", "hr-pg", 1, None),
        &spec("hr-pg", true),
    )
    .await;
    apply(
        &a,
        &grant(&a, "g-stop", "hr-stop", 1, None),
        &spec("hr-stop", false),
    )
    .await;
    let sub_attempt = apply(
        &a,
        &grant(&a, "g-sub", "hr-sub", 1, None),
        &spec("hr-sub", false),
    )
    .await;
    // A crash with a Submitted mutation for g-sub (journalled, never answered).
    let (sub_id, ..) = container("hr-sub").unwrap();
    let journal = a.engine.journal();
    let m: MutationId = "mut_00000000000000000000000000000abc".parse().unwrap();
    journal
        .append(Record::MutationIntent {
            mutation: MutationRecord {
                mutation_id: m.clone(),
                class: WorkloadClass::Tenant,
                slot: SlotRef::new("hr-sub".parse().unwrap(), 0),
                grant_id: Some(gid("g-sub")),
                attempt_id: sub_attempt.clone(),
                verb: EngineVerb::Restart,
                object_name: "restart".into(),
                container: Some(sub_id.parse().unwrap()),
                payload_hash: Sha256Hex::digest(b"restart"),
            },
        })
        .await
        .unwrap();
    journal
        .append(Record::MutationSubmitted {
            mutation_id: m,
            boot_id: a.engine.boot_id().clone(),
            incarnation: a.incarnation.clone(),
            engine_incarnation: "test".into(),
        })
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_secs(3)).await;
    let (pg_id, pg_started, ..) = container("hr-pg").unwrap();
    drop(a);

    // Process B: the exclusive containers are held and paused, not stopped;
    // the one with unresolved work takes the stop path.
    let b = start(dir.path(), long).await;
    b.reconcile().await.unwrap();
    let (id, started, paused, status) = container("hr-pg").unwrap();
    assert_eq!(
        (id.as_str(), started.as_str(), paused, status.as_str()),
        (pg_id.as_str(), pg_started.as_str(), true, "paused")
    );
    let reports = b.slot_reports().unwrap();
    let pg = reports.iter().find(|r| r.grant_id == gid("g-pg")).unwrap();
    let held = pg.held.as_ref().expect("reported as held");
    assert_eq!((&held.attempt_id, held.paused), (&pg_attempt, true));
    assert!(
        container("hr-stop").unwrap().2,
        "the other exclusive container is paused too"
    );
    let sub = container("hr-sub").unwrap();
    assert!(
        !sub.2 && sub.3 != "running",
        "unresolved work is stopped, never held: {sub:?}"
    );
    assert!(
        reports
            .iter()
            .find(|r| r.grant_id == gid("g-sub"))
            .unwrap()
            .held
            .is_none()
    );

    // The control plane adopts Postgres: same container, unpaused, never restarted.
    let adopted = apply(
        &b,
        &grant(&b, "g-pg-2", "hr-pg", 2, Some(&pg_attempt)),
        &spec("hr-pg", true),
    )
    .await;
    assert_eq!(adopted, pg_attempt);
    let (id, started, paused, status) = container("hr-pg").unwrap();
    assert_eq!(
        (id.as_str(), started.as_str(), paused, status.as_str()),
        (pg_id.as_str(), pg_started.as_str(), false, "running")
    );
    let state = b.engine.journal().snapshot().unwrap();
    assert!(state.grants[&gid("g-pg")].is_released());
    assert!(!state.grants[&gid("g-pg-2")].is_released());
    let ready = Command::new("docker")
        .args(["exec", &pg_id, "pg_isready", "-U", "postgres"])
        .status()
        .unwrap();
    assert!(ready.success(), "Postgres serves after adoption");
    // A second adoption of the same attempt is refused.
    let digest = Sha256Hex::digest(b"x");
    assert!(
        b.apply(
            &grant(&b, "g-pg-3", "hr-pg", 3, Some(&pg_attempt)),
            &spec("hr-pg", true),
            &"op-x".parse().unwrap(),
            digest
        )
        .await
        .is_err()
    );

    // The control plane says stop instead: certified, gone.
    let CommandResult::Stopped { certificate } = b
        .stop(&gid("g-stop"), "moved", &"op-stop".parse().unwrap(), None)
        .await
        .unwrap()
    else {
        panic!("not stopped")
    };
    let cert: StopCertificate = certificate
        .verify(&[public(NODE)], SignContext::StopCertificate)
        .unwrap();
    assert_eq!(cert.grant_id, gid("g-stop"));
    assert!(container("hr-stop").is_none_or(|c| c.3 != "running" && c.3 != "paused"));

    // Bound: a held container nobody adopts is stopped and certified once
    // the bound has passed.
    apply(
        &b,
        &grant(&b, "g-bound", "hr-bound", 1, None),
        &spec("hr-bound", false),
    )
    .await;
    drop(b);
    let c = start(dir.path(), Duration::from_secs(2)).await;
    c.reconcile().await.unwrap();
    assert!(container("hr-bound").unwrap().2, "held and paused");
    assert!(!c.engine.journal().snapshot().unwrap().grants[&gid("g-bound")].is_released());
    tokio::time::sleep(Duration::from_secs(3)).await;
    c.reconcile().await.unwrap();
    assert!(
        c.engine.journal().snapshot().unwrap().grants[&gid("g-bound")].is_released(),
        "stopped past the bound"
    );
    // The adopted Postgres grant belonged to B: C held it in turn, and with
    // nobody adopting it within the bound it was stopped and certified too.
    assert!(c.engine.journal().snapshot().unwrap().grants[&gid("g-pg-2")].is_released());
    cleanup();
}
