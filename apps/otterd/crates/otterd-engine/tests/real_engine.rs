//! The adapter against a real Docker Engine. Ignored by default; run on a
//! Linux host with Docker:
//!
//! ```sh
//! OTTERD_DOCKER_SOCKET=/var/run/docker.sock cargo test -p otterd-engine --test real_engine -- --ignored
//! ```
//!
//! It exercises the classification table against the Engine's real answers
//! (create, start twice, stop twice, kill on a stopped container, remove, and
//! every verb on an absent container).
#![allow(
    clippy::unwrap_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::too_many_lines
)]

use otterd_engine::{
    DockerClient, EngineAdapter, EngineOp, JournalHandle, MutationSpec, SubmitResult, object_name,
};
use otterd_journal::Journal;
use otterd_proto::U53;
use otterd_proto::envelope::PublicKey;
use otterd_proto::identity::{HostBinding, TrustedKey};
use otterd_proto::ids::{AttemptId, ContainerRef, Sha256Hex, SlotRef};
use otterd_proto::journal::{AttemptReason, EngineOutcome, Record, WorkloadClass};
use otterd_proto::lifecycle::{ProcessObservation, SlotGrant};
use otterd_proto::spec::{DisconnectAction, RestartPolicy};
use std::time::Duration;

fn id<T: std::str::FromStr>(s: &str) -> T
where
    T::Err: std::fmt::Debug,
{
    s.parse().unwrap()
}

const INC: &str = "inc_00000000000000000000000000000002";

async fn adapter(dir: &tempfile::TempDir) -> EngineAdapter {
    let socket =
        std::env::var("OTTERD_DOCKER_SOCKET").unwrap_or_else(|_| "/var/run/docker.sock".into());
    let mut docker = DockerClient::new(socket, Duration::from_secs(30));
    let version = docker.negotiate().await.unwrap();
    let mut j = Journal::create(&dir.path().join("node.journal"), "test").unwrap();
    let key = PublicKey::from_bytes([7; 32]);
    j.append(Record::Identity {
        install_id: id("inst"),
        node_id: id("node-real"),
        node_epoch: U53::ONE,
        key_epoch: U53::ONE,
        identity_key_id: key.key_id(),
        cp_keys: vec![TrustedKey {
            key: key.clone(),
            epoch: U53::ONE,
            not_after_unix_ms: None,
        }],
        recovery_key: key,
        host: HostBinding {
            machine_id: "m".into(),
            product_uuid: None,
            provider: None,
        },
    })
    .unwrap();
    j.append(Record::ProcessStarted {
        incarnation: id(INC),
        boot_id: id("boot"),
    })
    .unwrap();
    j.append(Record::GrantAccepted {
        grant: SlotGrant {
            grant_id: id("g-real"),
            slot: SlotRef::new(id("real"), 0),
            generation: U53::ONE,
            authority_term: U53::ONE,
            node_epoch: U53::ONE,
            incarnation: id(INC),
            exclusive: true,
            disconnect_action: DisconnectAction::Stop,
            restart: RestartPolicy::default(),
            data_claims: vec![],
            probe_only: false,
        },
        spec_digest: Sha256Hex::digest(b"spec"),
        op_id: id("op-real"),
    })
    .unwrap();
    let attempt = AttemptId::mint().unwrap();
    j.append(Record::AttemptBegun {
        grant_id: id("g-real"),
        attempt_id: attempt,
        ordinal: 1,
        reason: AttemptReason::Initial,
    })
    .unwrap();
    EngineAdapter::new(
        docker,
        JournalHandle::new(j),
        id("boot"),
        id(INC),
        format!("{}/real", version.version),
    )
}

fn spec(adapter: &EngineAdapter, op: EngineOp) -> MutationSpec {
    let attempt = adapter
        .journal()
        .read(|s| s.attempts.keys().next().cloned())
        .unwrap()
        .unwrap();
    MutationSpec {
        class: WorkloadClass::Tenant,
        slot: SlotRef::new(id("real"), 0),
        grant_id: Some(id("g-real")),
        attempt_id: attempt,
        op,
    }
}

async fn settle(adapter: &EngineAdapter, op: EngineOp) -> EngineOutcome {
    match adapter.submit(spec(adapter, op), |_| Ok(())).await.unwrap() {
        SubmitResult::Settled { outcome, .. } => outcome,
        other @ SubmitResult::Unresolved { .. } => {
            panic!("expected a terminal answer, got {other:?}")
        }
    }
}

#[tokio::test]
#[ignore = "needs a real Docker Engine"]
async fn real_engine_answers_match_the_classification_table() {
    let dir = tempfile::tempdir().unwrap();
    let a = adapter(&dir).await;
    let attempt: AttemptId = a
        .journal()
        .read(|s| s.attempts.keys().next().cloned())
        .unwrap()
        .unwrap();
    let name = object_name(&SlotRef::new(id("real"), 0), &attempt);
    // Pull is not journalled (no start authority); do it out of band.
    let pull = a
        .docker()
        .send(
            http::Method::POST,
            "/images/create?fromImage=busybox&tag=1.36",
            None,
        )
        .await
        .unwrap();
    assert!(pull.status.is_success(), "pull: {}", pull.message());

    let created = settle(
        &a,
        EngineOp::Create {
            name: name.clone(),
            config: serde_json::json!({"Image": "busybox:1.36", "Cmd": ["sleep", "3600"]}),
        },
    )
    .await;
    let EngineOutcome::Created { container } = created else {
        panic!("{created:?}")
    };
    let view = a.inspect(container.as_str()).await.unwrap().unwrap();
    assert_eq!(
        view.restart_policy, "no",
        "Docker restart policy forced to no"
    );
    assert_eq!(view.process, ProcessObservation::Created);

    // A second create with the same immutable name is a definitive refusal.
    let dup = settle(
        &a,
        EngineOp::Create {
            name: name.clone(),
            config: serde_json::json!({"Image": "busybox:1.36"}),
        },
    )
    .await;
    assert!(
        matches!(dup, EngineOutcome::Refused { status: 409, .. }),
        "{dup:?}"
    );

    let start = || EngineOp::Start {
        container: container.clone(),
        name: name.clone(),
    };
    assert_eq!(settle(&a, start()).await, EngineOutcome::Started);
    assert_eq!(settle(&a, start()).await, EngineOutcome::AlreadyStarted);
    assert!(matches!(
        a.inspect(container.as_str())
            .await
            .unwrap()
            .unwrap()
            .process,
        ProcessObservation::Running { .. }
    ));

    let stop = || EngineOp::Stop {
        container: container.clone(),
        name: name.clone(),
        timeout_s: 1,
    };
    assert_eq!(settle(&a, stop()).await, EngineOutcome::Stopped);
    assert_eq!(settle(&a, stop()).await, EngineOutcome::AlreadyStopped);
    let kill = settle(
        &a,
        EngineOp::Kill {
            container: container.clone(),
            name: name.clone(),
        },
    )
    .await;
    assert_eq!(
        kill,
        EngineOutcome::AlreadyStopped,
        "kill on a stopped container is 409"
    );
    assert!(matches!(
        a.inspect(container.as_str())
            .await
            .unwrap()
            .unwrap()
            .process,
        ProcessObservation::Exited { .. }
    ));

    assert_eq!(
        settle(
            &a,
            EngineOp::Remove {
                container: container.clone(),
                name: name.clone()
            }
        )
        .await,
        EngineOutcome::Removed
    );
    assert!(a.inspect(container.as_str()).await.unwrap().is_none());

    // Every verb on an absent object.
    let gone: ContainerRef = container.clone();
    for op in [
        EngineOp::Start {
            container: gone.clone(),
            name: name.clone(),
        },
        EngineOp::Stop {
            container: gone.clone(),
            name: name.clone(),
            timeout_s: 1,
        },
        EngineOp::Kill {
            container: gone.clone(),
            name: name.clone(),
        },
        EngineOp::Remove {
            container: gone.clone(),
            name: name.clone(),
        },
    ] {
        assert_eq!(settle(&a, op).await, EngineOutcome::Absent);
    }
    let state = a.journal().snapshot().unwrap();
    assert!(state.unresolved_submissions().next().is_none());
    println!(
        "engine {} — {} mutations, all settled",
        a.docker().socket().display(),
        state.mutations.len()
    );
}
