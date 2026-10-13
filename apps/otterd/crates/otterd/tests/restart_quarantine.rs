//! A daemon restart never stops a shared (overlap-tolerant) workload: it keeps
//! running for the control plane to re-bind. An exclusive one is held and
//! paused instead (see `held_restart.rs`). Ignored by default; run as root on a Linux
//! host with Docker:
//!
//! ```sh
//! cargo test -p otterd --test restart_quarantine -- --ignored --test-threads=1
//! ```
#![allow(clippy::unwrap_used, clippy::panic, clippy::too_many_lines)]

use ed25519_dalek::SigningKey;
use otterd::{LifecycleConfig, Node, Progress};
use otterd_engine::{DockerClient, EngineAdapter, JournalHandle};
use otterd_journal::Journal;
use otterd_proto::U53;
use otterd_proto::command::CommandResult;
use otterd_proto::envelope::{PublicKey, SignContext};
use otterd_proto::identity::{HostBinding, TrustedKey};
use otterd_proto::ids::{Incarnation, Sha256Hex, SlotRef};
use otterd_proto::journal::Record;
use otterd_proto::lifecycle::{SlotGrant, StopCertificate};
use otterd_proto::spec::{DisconnectAction, RestartPolicy, ServiceSpec, ServiceSpecInput};
use std::path::Path;
use std::process::Command;
use std::time::Duration;

const NODE: [u8; 32] = [2; 32];

fn id<T: std::str::FromStr>(s: &str) -> T
where
    T::Err: std::fmt::Debug,
{
    s.parse().unwrap()
}

fn public(seed: [u8; 32]) -> PublicKey {
    PublicKey::from_verifying_key(&SigningKey::from_bytes(&seed).verifying_key())
}

async fn start_node(dir: &Path) -> Node {
    let path = dir.join("node.journal");
    if !path.exists() {
        let mut j = Journal::create(&path, "test").unwrap();
        j.append(Record::Identity {
            install_id: id("inst"),
            node_id: id("node-rq"),
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
    let (mut journal, _) = Journal::open(&path).unwrap();
    let incarnation = Incarnation::mint().unwrap();
    let boot = otterd_sys::host::kernel_boot_id().unwrap();
    journal
        .append(Record::ProcessStarted {
            incarnation: incarnation.clone(),
            boot_id: id(&boot),
        })
        .unwrap();
    let mut docker = DockerClient::new("/var/run/docker.sock", Duration::from_secs(30));
    docker.negotiate().await.unwrap();
    let engine = EngineAdapter::new(
        docker,
        JournalHandle::new(journal),
        id(&boot),
        incarnation.clone(),
        "test".into(),
    );
    Node::new(
        LifecycleConfig {
            staging_root: dir.join("stage"),
            stop_grace: Duration::from_secs(2),
            boot_barrier_profile: String::new(),
            hold_bound: Duration::from_secs(300),
        },
        engine,
        SigningKey::from_bytes(&NODE),
        incarnation,
        Progress::default(),
    )
}

fn spec(resource: &str) -> ServiceSpec {
    serde_json::from_value::<ServiceSpecInput>(serde_json::json!({
        "resourceId": resource,
        "task": {"container": {"image": {"reference": "busybox:1.36"}, "args": ["sleep", "3600"], "stopGraceMs": 1000}}
    }))
    .unwrap()
    .normalize()
}

fn grant(
    node: &Node,
    grant_id: &str,
    resource: &str,
    generation: u64,
    exclusive: bool,
) -> SlotGrant {
    SlotGrant {
        grant_id: id(grant_id),
        slot: SlotRef::new(id(resource), 0),
        generation: U53::new(generation).unwrap(),
        authority_term: U53::ONE,
        node_epoch: U53::ONE,
        incarnation: node.incarnation.clone(),
        exclusive,
        disconnect_action: DisconnectAction::Stop,
        restart: RestartPolicy::default(),
        data_claims: vec![],
        probe_only: false,
        adopts_attempt: None,
        adopts_container: None,
        network: None,
    }
}

fn container_of(resource: &str) -> Option<(String, String)> {
    let out = Command::new("docker")
        .args([
            "ps",
            "-q",
            "--filter",
            &format!("label=dev.otterdeploy.slot={resource}#0"),
        ])
        .output()
        .unwrap();
    let id = String::from_utf8_lossy(&out.stdout).trim().to_owned();
    if id.is_empty() {
        return None;
    }
    let started = Command::new("docker")
        .args(["inspect", "-f", "{{.State.StartedAt}}", &id])
        .output()
        .unwrap();
    Some((
        id,
        String::from_utf8_lossy(&started.stdout).trim().to_owned(),
    ))
}

fn cleanup() {
    for r in ["rq-excl", "rq-shared"] {
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

#[tokio::test]
#[ignore = "needs root and Docker on Linux"]
async fn a_restart_stops_exclusive_attempts_and_keeps_shared_ones() {
    cleanup();
    let dir = tempfile::tempdir().unwrap();
    let node = start_node(dir.path()).await;
    let digest = |s: &ServiceSpec| Sha256Hex::digest(&serde_json::to_vec(s).unwrap());
    let (excl, shared) = (spec("rq-excl"), spec("rq-shared"));
    node.apply(
        &grant(&node, "g-excl", "rq-excl", 1, true),
        &excl,
        &id("op-1"),
        digest(&excl),
    )
    .await
    .unwrap();
    node.apply(
        &grant(&node, "g-shared", "rq-shared", 1, false),
        &shared,
        &id("op-2"),
        digest(&shared),
    )
    .await
    .unwrap();
    let excl_before = container_of("rq-excl").expect("exclusive running");
    let shared_before = container_of("rq-shared").expect("shared running");
    drop(node);

    // The daemon restarts: a new incarnation, boot quarantine.
    let node = start_node(dir.path()).await;
    node.reconcile().await.unwrap();
    let state = node.engine.journal().snapshot().unwrap();
    let excl_grant = &state.grants[&id::<otterd_proto::ids::GrantId>("g-excl")];
    assert!(
        !excl_grant.is_released() && excl_grant.held.as_ref().is_some_and(|h| h.paused),
        "the exclusive attempt is held and paused, not stopped"
    );
    assert_eq!(
        container_of("rq-excl"),
        Some(excl_before.clone()),
        "same container"
    );
    let shared_grant = &state.grants[&id::<otterd_proto::ids::GrantId>("g-shared")];
    assert!(
        !shared_grant.is_released(),
        "the shared grant is left for the control plane"
    );
    assert_eq!(
        container_of("rq-shared"),
        Some(shared_before.clone()),
        "same container, never restarted"
    );
    let reports = node.slot_reports().unwrap();
    assert!(
        reports.iter().any(|r| r.grant_id.as_str() == "g-shared"),
        "and it is reported"
    );

    // Further passes leave it alone; the control plane re-binds it with a new
    // grant (a new attempt may run beside it) and stops the old one when it wants.
    node.reconcile().await.unwrap();
    assert_eq!(container_of("rq-shared"), Some(shared_before));
    node.apply(
        &grant(&node, "g-shared-2", "rq-shared", 2, false),
        &shared,
        &id("op-3"),
        digest(&shared),
    )
    .await
    .unwrap();
    let CommandResult::Stopped { certificate } = node
        .stop(&id("g-shared"), "re-bound", &id("op-4"), None)
        .await
        .unwrap()
    else {
        panic!("not stopped")
    };
    let cert: StopCertificate = certificate
        .verify(&[public(NODE)], SignContext::StopCertificate)
        .unwrap();
    assert_eq!(cert.grant_id.as_str(), "g-shared");
    assert!(
        container_of("rq-shared").is_some(),
        "the re-bound attempt keeps running"
    );
    cleanup();
}
