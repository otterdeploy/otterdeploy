//! An attempt whose image is absent pulls it before the create, and an
//! attempt that cannot get its image, or that the Engine refuses to create,
//! fails terminally and visibly instead of never starting. Ignored by default;
//! run as root on a Linux host with Docker and registry access:
//!
//! ```sh
//! cargo test -p otterd --test image_pull -- --ignored --test-threads=1
//! ```
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::too_many_lines,
    clippy::needless_pass_by_value
)]

use ed25519_dalek::SigningKey;
use otterd::{LifecycleConfig, Node, NodeError, Progress};
use otterd_engine::{DockerClient, EngineAdapter, JournalHandle};
use otterd_journal::Journal;
use otterd_proto::U53;
use otterd_proto::command::{CommandResult, OpOutcome, SideEffects};
use otterd_proto::envelope::PublicKey;
use otterd_proto::identity::{HostBinding, TrustedKey};
use otterd_proto::ids::{GrantId, Incarnation, Sha256Hex, SlotRef};
use otterd_proto::journal::Record;
use otterd_proto::lifecycle::{GrantState, ProcessObservation, SlotGrant, SlotReport};
use otterd_proto::spec::{DisconnectAction, RestartPolicy, ServiceSpec, ServiceSpecInput};
use serde_json::Value;
use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

const NODE: [u8; 32] = [2; 32];
/// Small, and used by no other test: removed before the run so it must be
/// pulled.
const ABSENT: &str = "busybox:1.37-musl";
/// Present on the host (other tests use it).
const PRESENT: &str = "busybox:1.36";
const PULL_TIMEOUT: Duration = Duration::from_secs(120);

fn public(seed: [u8; 32]) -> PublicKey {
    PublicKey::from_verifying_key(&SigningKey::from_bytes(&seed).verifying_key())
}

async fn start(dir: &Path) -> Node {
    let path = dir.join("node.journal");
    if !path.exists() {
        let mut j = Journal::create(&path, "test").unwrap();
        j.append(Record::Identity {
            install_id: "inst".parse().unwrap(),
            node_id: "node-ip".parse().unwrap(),
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
    // The normal Engine budget is short; a pull gets its own.
    let mut d = DockerClient::new("/var/run/docker.sock", Duration::from_secs(10));
    d.negotiate().await.unwrap();
    Node::new(
        LifecycleConfig {
            staging_root: dir.join("stage"),
            stop_grace: Duration::from_secs(5),
            boot_barrier_profile: String::new(),
            hold_bound: Duration::from_secs(600),
            pull_timeout: PULL_TIMEOUT,
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

fn spec(resource: &str, image: Value) -> ServiceSpec {
    serde_json::from_value::<ServiceSpecInput>(serde_json::json!({
        "resourceId": resource,
        "task": {"container": {"image": image, "command": ["sleep", "3600"], "init": true}}
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

async fn apply(node: &Node, g: &SlotGrant, s: &ServiceSpec) -> Result<CommandResult, NodeError> {
    let digest = Sha256Hex::digest(&serde_json::to_vec(s).unwrap());
    node.apply(g, s, &format!("op-{}", g.grant_id).parse().unwrap(), digest)
        .await
}

/// What the control plane is answered for `workload.apply`.
fn answer(r: Result<CommandResult, NodeError>) -> OpOutcome {
    otterd::dispatch::outcome_of(r)
}

fn report(node: &Node, grant: &str) -> SlotReport {
    let id: GrantId = grant.parse().unwrap();
    node.slot_reports()
        .unwrap()
        .into_iter()
        .find(|r| r.grant_id == id)
        .unwrap()
}

/// The newest attempt of a slot report, as it goes on the wire.
fn wire_attempt(r: &SlotReport) -> Value {
    serde_json::to_value(r).unwrap()["attempts"]
        .as_array()
        .unwrap()
        .last()
        .cloned()
        .unwrap()
}

fn docker(args: &[&str]) -> (bool, String) {
    let out = Command::new("docker").args(args).output().unwrap();
    (
        out.status.success(),
        format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout).trim(),
            String::from_utf8_lossy(&out.stderr).trim()
        ),
    )
}

fn image_present(image: &str) -> bool {
    docker(&["image", "inspect", image]).0
}

/// Every container otterd made for a slot.
fn slot_containers(resource: &str) -> String {
    docker(&[
        "ps",
        "-aq",
        "--filter",
        &format!("label=dev.otterdeploy.slot={resource}#0"),
    ])
    .1
}

fn remove_slot_containers(resource: &str) {
    for id in slot_containers(resource).split_whitespace() {
        let _ = docker(&["rm", "-f", id]);
    }
}

async fn stop(node: &Node, grant: &str) {
    let r = node
        .stop(
            &grant.parse().unwrap(),
            "test done",
            &format!("op-stop-{grant}").parse().unwrap(),
            None,
        )
        .await
        .unwrap();
    assert!(matches!(r, CommandResult::Stopped { .. }), "{r:?}");
}

#[tokio::test]
#[ignore = "needs root, Docker and registry access on Linux"]
async fn an_absent_image_is_pulled_before_the_create() {
    for r in ["ip-pull", "ip-pin"] {
        remove_slot_containers(r);
    }
    let _ = docker(&["rmi", "-f", ABSENT]);
    assert!(!image_present(ABSENT), "{ABSENT} is still present");
    let dir = tempfile::tempdir().unwrap();
    let node = start(dir.path()).await;
    node.reconcile().await.unwrap();

    // By tag: pulled, created, running.
    let g = grant(&node, "g-pull", "ip-pull");
    let r = apply(
        &node,
        &g,
        &spec("ip-pull", serde_json::json!({"reference": ABSENT})),
    )
    .await;
    let outcome = answer(r);
    assert!(
        matches!(
            &outcome,
            OpOutcome::Completed {
                result: CommandResult::Applied { .. }
            }
        ),
        "{outcome:?}"
    );
    assert!(image_present(ABSENT), "the image was pulled");
    node.reconcile().await.unwrap();
    let rep = report(&node, "g-pull");
    assert_eq!(rep.state, GrantState::Running);
    assert!(
        matches!(rep.attempts[0].process, ProcessObservation::Running { .. }),
        "{:?}",
        rep.attempts[0].process
    );
    assert!(wire_attempt(&rep).get("failure").is_none());

    // By pinned digest: the pull fetches exactly that content.
    let (ok, repo_digest) = docker(&["image", "inspect", "-f", "{{index .RepoDigests 0}}", ABSENT]);
    assert!(ok, "{repo_digest}");
    let digest = repo_digest.rsplit_once('@').unwrap().1.to_owned();
    stop(&node, "g-pull").await;
    let _ = docker(&["rmi", "-f", ABSENT]);
    assert!(!image_present(ABSENT));
    let g = grant(&node, "g-pin", "ip-pin");
    let s = spec(
        "ip-pin",
        serde_json::json!({"reference": ABSENT, "digest": digest}),
    );
    let outcome = answer(apply(&node, &g, &s).await);
    assert!(
        matches!(&outcome, OpOutcome::Completed { .. }),
        "{outcome:?}"
    );
    assert!(image_present(&format!("busybox@{digest}")));
    node.reconcile().await.unwrap();
    let rep = report(&node, "g-pin");
    assert!(
        matches!(rep.attempts[0].process, ProcessObservation::Running { .. }),
        "{:?}",
        rep.attempts[0].process
    );
    stop(&node, "g-pin").await;
    let _ = docker(&["rmi", "-f", ABSENT]);
}

#[tokio::test]
#[ignore = "needs root, Docker and registry access on Linux"]
async fn an_attempt_that_cannot_get_its_image_fails_terminally() {
    let cases = [
        (
            "g-bad-tag",
            "ip-bad-tag",
            serde_json::json!({"reference": "busybox:does-not-exist"}),
            "image-pull-failed",
        ),
        (
            "g-bad-host",
            "ip-bad-host",
            serde_json::json!({"reference": "registry.invalid/none:1"}),
            "image-pull-failed",
        ),
        (
            "g-bad-digest",
            "ip-bad-digest",
            serde_json::json!({"reference": "busybox:1.37",
                "digest": format!("sha256:{}", "0".repeat(64))}),
            "image-pull-failed",
        ),
    ];
    for (_, resource, ..) in &cases {
        remove_slot_containers(resource);
    }
    remove_slot_containers("ip-refused");
    let dir = tempfile::tempdir().unwrap();
    let node = start(dir.path()).await;
    node.reconcile().await.unwrap();

    for (grant_id, resource, image, code) in &cases {
        let began = Instant::now();
        let r = apply(
            &node,
            &grant(&node, grant_id, resource),
            &spec(resource, image.clone()),
        )
        .await;
        assert!(
            began.elapsed() < PULL_TIMEOUT,
            "{grant_id}: bounded by the pull timeout"
        );
        // Answered as failed, with no side effects: nothing was created.
        match answer(r) {
            OpOutcome::Failed {
                code: c,
                message,
                side_effects,
            } => {
                eprintln!("{grant_id}: failed {c}: {message}");
                assert_eq!(&c, code, "{grant_id}: {message}");
                assert!(!message.is_empty());
                assert_eq!(side_effects, SideEffects::None);
            }
            other => panic!("{grant_id}: answered {other:?}"),
        }
        assert_eq!(slot_containers(resource), "", "{grant_id}: no container");
    }

    // The Engine refuses the create (a relative mount target): failed too.
    let mut refused = spec("ip-refused", serde_json::json!({"reference": PRESENT}));
    refused.task.mounts =
        serde_json::from_value(serde_json::json!([{"kind": "tmpfs", "target": "relative/path"}]))
            .unwrap();
    let r = apply(&node, &grant(&node, "g-refused", "ip-refused"), &refused).await;
    match answer(r) {
        OpOutcome::Failed {
            code,
            message,
            side_effects,
        } => {
            eprintln!("g-refused: failed {code}: {message}");
            assert_eq!(code, "create-refused");
            assert_eq!(side_effects, SideEffects::None);
        }
        other => panic!("create refusal answered {other:?}"),
    }

    // The slot reports a terminal failure, not an attempt still starting,
    // and reconcile passes leave it so.
    node.reconcile().await.unwrap();
    node.reconcile().await.unwrap();
    for (grant_id, code) in cases
        .iter()
        .map(|(g, _, _, c)| (*g, *c))
        .chain([("g-refused", "create-refused")])
    {
        let rep = report(&node, grant_id);
        assert_ne!(rep.state, GrantState::Starting, "{grant_id}");
        assert_ne!(
            rep.state,
            GrantState::Unknown,
            "{grant_id}: nothing is unresolved"
        );
        assert_eq!(
            rep.attempts.len(),
            1,
            "{grant_id}: never retried by the node"
        );
        let a = wire_attempt(&rep);
        assert_eq!(a["process"]["state"], "absent", "{grant_id}: {a}");
        assert_eq!(a["failure"]["code"], code, "{grant_id}: {a}");
        assert!(
            !a["failure"]["message"].as_str().unwrap().is_empty(),
            "{grant_id}: a reason"
        );
    }

    // Nothing ran, so the control plane's stop certifies at once.
    stop(&node, "g-bad-tag").await;
    assert_eq!(report(&node, "g-bad-tag").state, GrantState::Released);

    // The failure is journalled: a restarted node still reports it.
    drop(node);
    let node = start(dir.path()).await;
    let a = wire_attempt(&report(&node, "g-bad-host"));
    assert_eq!(a["failure"]["code"], "image-pull-failed", "{a}");
    assert_eq!(a["process"]["state"], "absent", "{a}");
    node.reconcile().await.unwrap();
    let a = wire_attempt(&report(&node, "g-bad-host"));
    assert_eq!(a["failure"]["code"], "image-pull-failed", "{a}");
    for (_, resource, ..) in &cases {
        remove_slot_containers(resource);
    }
    remove_slot_containers("ip-refused");
}
