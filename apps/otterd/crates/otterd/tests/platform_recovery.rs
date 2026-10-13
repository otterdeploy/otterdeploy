//! The control plane's recovery mode against a real Docker Engine. An update
//! starts the new control plane in recovery mode exactly once: a daemon
//! restart after the commit, or a resume after the schema boundary, continues
//! it instead of starting it again in normal mode (its start runs the schema
//! migration). It leaves recovery mode only through `platform.recovered`: one
//! journalled exit and one restart in normal mode, none on a retry or a later
//! boot. Ignored by default; run as root on a Linux host with Docker:
//!
//! ```sh
//! cargo test -p otterd --test platform_recovery -- --ignored --test-threads=1
//! ```
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::too_many_lines
)]

use ed25519_dalek::SigningKey;
use otterd::platform::{Platform, PlatformConfig};
use otterd_engine::{DockerClient, EngineAdapter, JournalHandle};
use otterd_journal::{Journal, Submission};
use otterd_proto::U53;
use otterd_proto::envelope::{PublicKey, SignContext, SignedEnvelope};
use otterd_proto::identity::HostBinding;
use otterd_proto::ids::{Incarnation, Sha256Hex, SlotRef, UpdateId};
use otterd_proto::journal::{EngineOutcome, Record, UpdatePhase};
use otterd_proto::platform::PlatformBootManifest;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

const RECOVERY: [u8; 32] = [3; 32];
const NET: &str = "otterd-pr";
const CP: &str = "pr-cp";

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
        "--filter",
        "name=platform-pr-",
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

/// A manifest whose control plane has a recovery environment.
fn manifest(host: &HostBinding, revision: u64, previous: Option<&Sha256Hex>) -> SignedEnvelope {
    let img = image();
    let m: PlatformBootManifest = serde_json::from_value(serde_json::json!({
        "schema": 1, "installId": "inst_pr", "host": host,
        "bootstrapEpoch": 1, "manifestRevision": revision, "authorityTerm": 2,
        "previousManifestDigest": previous,
        "network": {"name": NET, "subnet": "10.252.0.0/24", "gateway": "10.252.0.1"},
        "members": [
            {"name": "pr-pg", "role": "postgres", "ip": "10.252.0.2", "image": img, "cmd": http(5432),
             "readiness": {"kind": "tcp", "port": 5432}},
            {"name": "pr-redis", "role": "redis", "ip": "10.252.0.3", "image": img, "cmd": http(6379),
             "readiness": {"kind": "tcp", "port": 6379}},
            {"name": CP, "role": "control-plane", "ip": "10.252.0.4", "image": img, "cmd": http(3000),
             "env": {"CP_REVISION": revision.to_string()}, "recoveryEnv": {"OTTERDEPLOY_RECOVERY": "1"},
             "dependsOn": ["pr-pg", "pr-redis"], "readiness": {"kind": "http", "port": 3000, "path": "/health"}}
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

/// A fresh daemon process on the same bootstrap journal.
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

/// Control-plane containers created so far: the slot's settled creates.
fn cp_creates(p: &Platform) -> usize {
    let slot = SlotRef::new(format!("platform/{CP}").parse().unwrap(), 0);
    p.engine()
        .journal()
        .snapshot()
        .unwrap()
        .mutations_of_slot(&slot)
        .filter(|m| {
            matches!(
                m.submission,
                Submission::Settled {
                    outcome: EngineOutcome::Created { .. }
                }
            )
        })
        .count()
}

fn cp_container() -> String {
    docker(&[
        "ps",
        "-q",
        "--no-trunc",
        "--filter",
        "label=dev.otterdeploy.class=platform",
        "--filter",
        &format!("name=platform-{CP}"),
    ])
}

/// `(revision, recovery mode)` of the running control plane.
fn cp_state() -> (String, bool) {
    let env = docker(&["inspect", "-f", "{{json .Config.Env}}", &cp_container()]);
    let revision = env
        .split("CP_REVISION=")
        .nth(1)
        .and_then(|r| r.split('"').next())
        .unwrap_or("none")
        .to_owned();
    (revision, env.contains("OTTERDEPLOY_RECOVERY=1"))
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
        docker(&["rm", "-f", &cp_container()]);
    }
}

#[tokio::test]
#[ignore = "needs root and Docker on Linux"]
async fn an_update_starts_its_control_plane_once() {
    cleanup();
    let dir = tempfile::tempdir().unwrap();
    let host = otterd_sys::host::host_binding(None).unwrap();
    let p = platform(dir.path()).await;
    let v1 = manifest(&host, 1, None);
    p.install(&v1, &host).await.unwrap();
    p.boot(&host, U53::ZERO, false).await.unwrap();
    assert_eq!(cp_state(), ("1".into(), false), "installed in normal mode");
    assert_eq!(cp_creates(&p), 1);

    // A live update: one start of the new control plane, in recovery mode.
    let v2 = manifest(&host, 2, Some(&v1.payload_digest().unwrap()));
    p.update(&v2, &host, U53::ZERO).await.unwrap();
    assert_eq!(
        cp_state(),
        ("2".into(), true),
        "the update starts recovery mode"
    );
    assert_eq!(cp_creates(&p), 2, "one start for the update");
    let started = cp_container();
    drop(p);

    // A daemon restart after the commit continues it, still in recovery mode.
    let p = platform(dir.path()).await;
    p.boot(&host, U53::ZERO, false).await.unwrap();
    assert_eq!(cp_creates(&p), 2, "a restart does not start it again");
    assert_eq!(cp_container(), started, "the same container runs on");
    assert_eq!(cp_state(), ("2".into(), true));
    drop(p);

    // Interrupted after the schema boundary: the resume starts it once, and
    // the rest of that boot and the next one continue it.
    let v3 = manifest(&host, 3, Some(&v2.payload_digest().unwrap()));
    let p = platform(dir.path()).await;
    interrupted(&p, &v3, UpdatePhase::SchemaBoundary).await;
    drop(p);
    let p = platform(dir.path()).await;
    p.boot(&host, U53::ZERO, false).await.unwrap();
    assert_eq!(
        p.engine()
            .journal()
            .snapshot()
            .unwrap()
            .update
            .unwrap()
            .phase,
        UpdatePhase::Committed
    );
    assert_eq!(cp_state(), ("3".into(), true));
    assert_eq!(cp_creates(&p), 3, "one start for the resumed update");
    let started = cp_container();
    drop(p);
    let p = platform(dir.path()).await;
    p.boot(&host, U53::ZERO, false).await.unwrap();
    assert_eq!(cp_creates(&p), 3, "a restart does not start it again");
    assert_eq!(cp_container(), started);
    cleanup();
}

#[tokio::test]
#[ignore = "needs root and Docker on Linux"]
async fn the_control_plane_leaves_recovery_mode_once() {
    cleanup();
    let dir = tempfile::tempdir().unwrap();
    let host = otterd_sys::host::host_binding(None).unwrap();
    let p = platform(dir.path()).await;
    let v1 = manifest(&host, 1, None);
    p.install(&v1, &host).await.unwrap();
    p.boot(&host, U53::ZERO, false).await.unwrap();
    let v1_digest = v1.payload_digest().unwrap();
    let v2 = manifest(&host, 2, Some(&v1_digest));
    let v2_digest = v2.payload_digest().unwrap();
    p.update(&v2, &host, U53::ZERO).await.unwrap();
    assert_eq!(cp_state(), ("2".into(), true));
    assert_eq!(cp_creates(&p), 2);

    // Only the active manifest's control plane can leave recovery mode.
    assert!(p.leave_recovery(&v1_digest).await.is_err());
    let left = |p: &Platform| p.engine().journal().snapshot().unwrap().recovery_left;
    assert_eq!(left(&p), None);

    // The exit is journalled, then the control plane restarts once, in
    // normal mode.
    assert!(
        p.leave_recovery(&v2_digest).await.unwrap(),
        "a restart is due"
    );
    assert_eq!(left(&p), Some(v2_digest.clone()));
    p.finish_recovery().await.unwrap();
    assert_eq!(cp_state(), ("2".into(), false), "normal mode");
    assert_eq!(cp_creates(&p), 3, "exactly one more start");
    let normal = cp_container();

    // A retry answers without another restart.
    assert!(
        !p.leave_recovery(&v2_digest).await.unwrap(),
        "nothing to do"
    );
    p.finish_recovery().await.unwrap();
    assert_eq!(cp_creates(&p), 3);
    assert_eq!(cp_container(), normal);
    drop(p);

    // A later daemon restart keeps normal mode and the same container.
    let p = platform(dir.path()).await;
    p.boot(&host, U53::ZERO, false).await.unwrap();
    assert_eq!(cp_creates(&p), 3);
    assert_eq!(cp_container(), normal);
    assert_eq!(cp_state(), ("2".into(), false));

    // The next update starts recovery mode again; a crash after the exit is
    // journalled but before the restart is finished by the next boot, once.
    let v3 = manifest(&host, 3, Some(&v2_digest));
    let v3_digest = v3.payload_digest().unwrap();
    p.update(&v3, &host, U53::ZERO).await.unwrap();
    assert_eq!(cp_state(), ("3".into(), true));
    assert_eq!(cp_creates(&p), 4);
    assert_eq!(left(&p), None, "a new manifest has not left recovery mode");
    assert!(p.leave_recovery(&v3_digest).await.unwrap());
    drop(p);
    let p = platform(dir.path()).await;
    p.boot(&host, U53::ZERO, false).await.unwrap();
    assert_eq!(cp_state(), ("3".into(), false));
    assert_eq!(cp_creates(&p), 5, "the journalled exit restarts it once");
    let normal = cp_container();
    drop(p);
    let p = platform(dir.path()).await;
    p.boot(&host, U53::ZERO, false).await.unwrap();
    assert_eq!(cp_creates(&p), 5);
    assert_eq!(cp_container(), normal);

    // The operator's recovery request continues a running control plane in
    // the mode it runs in; it is never restarted to change mode.
    drop(p);
    let p = platform(dir.path()).await;
    p.boot(&host, U53::ZERO, true).await.unwrap();
    assert_eq!(cp_creates(&p), 5);
    assert_eq!(cp_container(), normal);
    cleanup();
}
