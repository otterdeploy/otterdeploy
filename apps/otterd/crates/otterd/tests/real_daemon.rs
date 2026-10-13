//! The daemon's lifecycle and dispatch against a real Docker Engine, with a
//! test control plane minting capabilities. Ignored by default; run as root on
//! a Linux host with Docker:
//!
//! ```sh
//! cargo test -p otterd --test real_daemon -- --ignored --test-threads=1
//! ```
#![allow(
    clippy::unwrap_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::too_many_lines
)]

use ed25519_dalek::SigningKey;
use otterd::{Answer, Dispatcher, LifecycleConfig, Node, Progress, Session};
use otterd_engine::{DockerClient, EngineAdapter, JournalHandle};
use otterd_journal::Journal;
use otterd_proto::U53;
use otterd_proto::capability::{
    AttemptBinding, Capability, CapabilityError, ClockBound, Principal, PrincipalKind, Verb,
};
use otterd_proto::channel::RequestRefusal;
use otterd_proto::command::{Command, CommandResult, OpOutcome};
use otterd_proto::envelope::{PublicKey, SignContext, SignedEnvelope};
use otterd_proto::identity::{HostBinding, TrustedKey};
use otterd_proto::ids::{Incarnation, Nonce, Sha256Hex, SlotRef};
use otterd_proto::journal::Record;
use otterd_proto::lifecycle::{SlotGrant, StopCertificate};
use otterd_proto::spec::{DisconnectAction, RestartPolicy, ServiceSpec, ServiceSpecInput};
use std::path::Path;
use std::time::Duration;

const CP: [u8; 32] = [1; 32];
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

fn now_ms() -> U53 {
    otterd_journal::now_unix_ms()
}

fn create_journal(path: &Path) {
    let mut j = Journal::create(path, "test").unwrap();
    j.append(Record::Identity {
        install_id: id("inst"),
        node_id: id("node-real"),
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
}

/// Start a node process on the journal: a new incarnation, boot quarantine.
async fn start_node(dir: &Path) -> Node {
    let (mut journal, _) = Journal::open(&dir.join("node.journal")).unwrap();
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
        },
        engine,
        SigningKey::from_bytes(&NODE),
        incarnation,
        Progress::default(),
    )
}

fn session() -> Session {
    Session {
        session_id: id("sess-1"),
        authority_term: U53::ONE,
        clock: Some(ClockBound {
            now_unix_ms: now_ms(),
            uncertainty_ms: U53::from_const(100),
        }),
        monitor_only: false,
        protocol: 1,
    }
}

/// The test control plane: mint a capability for exactly this payload.
fn request(
    verb: Verb,
    op: &str,
    epoch: u64,
    command: &Command,
    binding: Option<AttemptBinding>,
) -> (SignedEnvelope, String) {
    let payload = serde_json::to_string(command).unwrap();
    let now = now_ms();
    let cap = Capability {
        install_id: id("inst"),
        org_id: None,
        principal: Principal {
            kind: PrincipalKind::System,
            id: "scheduler".into(),
        },
        aud: id("node-real"),
        node_epoch: U53::ONE,
        authority_term: U53::ONE,
        verb,
        resource_id: Some(id("svc-real")),
        binding,
        path_root: None,
        volume: None,
        operation_epoch: U53::new(epoch).unwrap(),
        op_id: id(op),
        payload_hash: Sha256Hex::digest(payload.as_bytes()),
        nonce: Nonce::random().unwrap(),
        session_id: id("sess-1"),
        // Backdated like the control plane does, to absorb clock uncertainty.
        not_before_unix_ms: now.saturating_sub(5_000),
        expires_at_unix_ms: now.saturating_add(30_000),
        max_bytes: None,
        permissions: verb.required().to_vec(),
    };
    (
        SignedEnvelope::sign(&SigningKey::from_bytes(&CP), SignContext::Capability, &cap).unwrap(),
        payload,
    )
}

fn spec(data: Option<&Path>) -> ServiceSpec {
    let mut v = serde_json::json!({
        "resourceId": "svc-real",
        "task": {"container": {"image": {"reference": "busybox:1.36"}, "args": ["sleep", "3600"], "stopGraceMs": 1000}}
    });
    if let Some(d) = data {
        v["task"]["mounts"] = serde_json::json!([{"kind": "bind", "source": d.display().to_string(), "target": "/data", "dataIdentity": "data:1"}]);
    }
    serde_json::from_value::<ServiceSpecInput>(v)
        .unwrap()
        .normalize()
}

fn grant(node: &Node, id_: &str, generation: u64) -> SlotGrant {
    SlotGrant {
        grant_id: id(id_),
        slot: SlotRef::new(id("svc-real"), 0),
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
    }
}

fn outcome(a: Answer) -> (bool, OpOutcome) {
    match a {
        Answer::Outcome {
            duplicate, outcome, ..
        } => (duplicate, outcome),
        Answer::Refused(r) => panic!("refused: {r:?}"),
    }
}

/// Remove what an earlier, interrupted run of this test left behind: the node
/// rightly refuses to start over containers its journal does not know.
fn remove_leftovers() {
    let out = std::process::Command::new("docker")
        .args([
            "ps",
            "-aq",
            "--filter",
            "label=dev.otterdeploy.slot=svc-real#0",
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

fn docker_ps(filter: &str) -> String {
    let out = std::process::Command::new("docker")
        .args([
            "ps",
            "-a",
            "--filter",
            filter,
            "--format",
            "{{.Names}} {{.State}}",
        ])
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stdout).into_owned()
}

#[tokio::test]
#[ignore = "needs root and Docker on Linux"]
async fn apply_stop_quarantine_and_capability_rules() {
    remove_leftovers();
    let dir = tempfile::tempdir().unwrap();
    create_journal(&dir.path().join("node.journal"));
    let data = dir.path().join("data");
    std::fs::create_dir(&data).unwrap();
    let node = start_node(dir.path()).await;
    let d = Dispatcher::new();
    let s = session();

    // Apply: the node checks the capability, claims the op, stages the bind, starts.
    let g1 = grant(&node, "g1", 1);
    let apply = Command::WorkloadApply {
        grant: g1.clone(),
        spec: spec(Some(&data)),
    };
    let binding = Some(AttemptBinding {
        slot: g1.slot.clone(),
        grant_id: g1.grant_id.clone(),
        generation: g1.generation,
        attempt_id: None,
    });
    let (cap, payload) = request(
        Verb::WorkloadApply,
        "op-apply-1",
        1,
        &apply,
        binding.clone(),
    );
    let (dup, out) = outcome(d.handle(&node, &s, &cap, &payload).await);
    assert!(!dup);
    let OpOutcome::Completed {
        result: CommandResult::Applied { attempt_id, .. },
    } = out
    else {
        panic!("{out:?}")
    };
    assert!(docker_ps(&format!("label=dev.otterdeploy.attempt={attempt_id}")).contains("running"));
    let state = node.engine.journal().snapshot().unwrap();
    assert_eq!(state.open_holds().count(), 1, "the bind is held and staged");

    // Replays: the same capability is refused (nonce); a fresh capability for
    // the same op returns the recorded outcome; a different payload conflicts.
    assert!(matches!(
        d.handle(&node, &s, &cap, &payload).await,
        Answer::Refused(RequestRefusal::Capability {
            error: CapabilityError::Replayed
        })
    ));
    let (cap2, payload2) = request(
        Verb::WorkloadApply,
        "op-apply-1",
        1,
        &apply,
        binding.clone(),
    );
    let (dup, out) = outcome(d.handle(&node, &s, &cap2, &payload2).await);
    assert!(dup && matches!(out, OpOutcome::Completed { .. }));
    let other = Command::WorkloadApply {
        grant: grant(&node, "g9", 9),
        spec: spec(None),
    };
    let (cap3, payload3) = request(Verb::WorkloadApply, "op-apply-1", 1, &other, None);
    assert!(matches!(
        outcome(d.handle(&node, &s, &cap3, &payload3).await).1,
        OpOutcome::Conflict { .. }
    ));

    // Capability rules: payload tampering, another session, a stale op epoch.
    let (cap4, payload4) = request(
        Verb::WorkloadInspect,
        "op-i",
        1,
        &Command::WorkloadInspect {
            resource_id: None,
            grant_ids: vec![],
        },
        None,
    );
    assert!(matches!(
        d.handle(&node, &s, &cap4, &format!("{payload4} ")).await,
        Answer::Refused(RequestRefusal::Capability {
            error: CapabilityError::PayloadMismatch
        })
    ));
    let mut other_session = session();
    other_session.session_id = id("sess-2");
    assert!(matches!(
        d.handle(&node, &other_session, &cap4, &payload4).await,
        Answer::Refused(RequestRefusal::Capability {
            error: CapabilityError::WrongSession
        })
    ));
    let (cap5, payload5) = request(
        Verb::WorkloadInspect,
        "op-old",
        0,
        &Command::WorkloadInspect {
            resource_id: None,
            grant_ids: vec![],
        },
        None,
    );
    assert!(matches!(
        d.handle(&node, &s, &cap5, &payload5).await,
        Answer::Refused(RequestRefusal::Capability {
            error: CapabilityError::StaleOperationEpoch { .. }
        })
    ));
    let mut no_clock = session();
    no_clock.clock = None;
    assert!(matches!(
        d.handle(&node, &no_clock, &cap4, &payload4).await,
        Answer::Refused(RequestRefusal::Capability {
            error: CapabilityError::ClockUnknown
        })
    ));

    // A second exclusive generation is refused while g1 holds the slot.
    let apply2 = Command::WorkloadApply {
        grant: grant(&node, "g2", 2),
        spec: spec(None),
    };
    let (cap6, payload6) = request(Verb::WorkloadApply, "op-apply-2", 2, &apply2, None);
    assert!(matches!(
        outcome(d.handle(&node, &s, &cap6, &payload6).await).1,
        OpOutcome::Failed { .. }
    ));

    // Stop: revoke first, stop, remove, certify; the certificate verifies.
    let stop = Command::WorkloadStop {
        grant_id: id("g1"),
        reason: "rollout".into(),
        stop_grace_ms: Some(U53::from_const(1000)),
    };
    let (cap7, payload7) = request(Verb::WorkloadStop, "op-stop-1", 2, &stop, None);
    let (_, out) = outcome(d.handle(&node, &s, &cap7, &payload7).await);
    let OpOutcome::Completed {
        result: CommandResult::Stopped { certificate },
    } = out
    else {
        panic!("{out:?}")
    };
    let cert: StopCertificate = certificate
        .verify(&[public(NODE)], SignContext::StopCertificate)
        .unwrap();
    assert!(
        cert.cgroups_empty
            && cert
                .containers
                .iter()
                .all(|c| c.process.is_positively_stopped())
    );
    assert!(
        docker_ps(&format!("label=dev.otterdeploy.attempt={attempt_id}")).is_empty(),
        "container removed"
    );
    let state = node.engine.journal().snapshot().unwrap();
    assert_eq!(
        state.open_holds().count(),
        0,
        "holds released after the certificate"
    );

    // Next generation runs; then a "restart" (new incarnation on the same
    // journal) quarantines it: the reconciler stops and certifies g3 on its own.
    let g3 = grant(&node, "g3", 3);
    let (cap8, payload8) = request(
        Verb::WorkloadApply,
        "op-apply-3",
        3,
        &Command::WorkloadApply {
            grant: g3.clone(),
            spec: spec(None),
        },
        None,
    );
    let (_, out) = outcome(d.handle(&node, &s, &cap8, &payload8).await);
    let OpOutcome::Completed {
        result: CommandResult::Applied { attempt_id: a3, .. },
    } = out
    else {
        panic!("{out:?}")
    };
    assert!(docker_ps(&format!("label=dev.otterdeploy.attempt={a3}")).contains("running"));
    drop(d);
    drop(node);
    let node = start_node(dir.path()).await;
    // A grant minted for the old incarnation is refused outright.
    let d = Dispatcher::new();
    let old_incarnation_apply = Command::WorkloadApply {
        grant: g3.clone(),
        spec: spec(None),
    };
    let (cap9, payload9) = request(
        Verb::WorkloadApply,
        "op-apply-stale",
        4,
        &old_incarnation_apply,
        None,
    );
    assert!(matches!(
        outcome(d.handle(&node, &s, &cap9, &payload9).await).1,
        OpOutcome::Failed { .. }
    ));
    node.reconcile().await.unwrap();
    let state = node.engine.journal().snapshot().unwrap();
    let g3s = &state.grants[&id::<otterd_proto::ids::GrantId>("g3")];
    assert!(
        g3s.is_released(),
        "boot quarantine stopped and certified the old incarnation's grant"
    );
    assert!(docker_ps(&format!("label=dev.otterdeploy.attempt={a3}")).is_empty());
    // A fresh grant for this incarnation runs.
    let g5 = grant(&node, "g5", 5);
    let (cap10, payload10) = request(
        Verb::WorkloadApply,
        "op-apply-5",
        5,
        &Command::WorkloadApply {
            grant: g5,
            spec: spec(None),
        },
        None,
    );
    assert!(matches!(
        outcome(d.handle(&node, &s, &cap10, &payload10).await).1,
        OpOutcome::Completed { .. }
    ));
    let (cap11, payload11) = request(
        Verb::WorkloadStop,
        "op-stop-5",
        5,
        &Command::WorkloadStop {
            grant_id: id("g5"),
            reason: "done".into(),
            stop_grace_ms: None,
        },
        None,
    );
    assert!(matches!(
        outcome(d.handle(&node, &s, &cap11, &payload11).await).1,
        OpOutcome::Completed {
            result: CommandResult::Stopped { .. }
        }
    ));
}
