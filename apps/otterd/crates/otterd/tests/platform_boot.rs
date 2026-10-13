//! N=1 platform boot against a real Docker Engine: Postgres, Redis and a
//! control-plane stand-in from local archives, in dependency order, gated on
//! readiness; continued after a daemon restart; reloaded from the signed
//! archive when the image is gone; refused when the archive does not match or
//! the recovery root revoked the manifest's term. Ignored by default; run as
//! root on a Linux host with Docker and network access for the first pull:
//!
//! ```sh
//! cargo test -p otterd --test platform_boot -- --ignored --test-threads=1
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
use otterd_journal::{Journal, Submission};
use otterd_proto::U53;
use otterd_proto::envelope::{PublicKey, SignContext, SignedEnvelope};
use otterd_proto::ids::{Incarnation, Sha256Hex};
use otterd_proto::journal::EngineOutcome;
use otterd_proto::lifecycle::EngineVerb;
use otterd_proto::platform::PlatformBootManifest;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

const RECOVERY: [u8; 32] = [3; 32];
const IMAGES: &str = "/var/lib/otterd/platform-images-test";
const NET: &str = "otterd-pt";

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
    let _ = std::fs::remove_dir_all("/var/lib/otterd/platform/pt-pg");
}

fn archive(reference: &str, name: &str) -> serde_json::Value {
    docker(&["pull", "-q", reference]);
    std::fs::create_dir_all(IMAGES).unwrap();
    let path = format!("{IMAGES}/{name}.tar");
    if !Path::new(&path).exists() {
        assert!(
            Command::new("docker")
                .args(["save", "-o", &path, reference])
                .status()
                .unwrap()
                .success()
        );
    }
    serde_json::json!({
        "reference": reference,
        "id": docker(&["image", "inspect", "-f", "{{.Id}}", reference]),
        "archive": path,
        "archiveSha256": Sha256Hex::digest(&std::fs::read(&path).unwrap()),
    })
}

fn manifest(host: &otterd_proto::identity::HostBinding) -> SignedEnvelope {
    let m: PlatformBootManifest = serde_json::from_value(serde_json::json!({
        "schema": 1, "installId": "inst_pt", "host": host,
        "bootstrapEpoch": 1, "manifestRevision": 1, "authorityTerm": 2,
        "network": {"name": NET, "subnet": "10.251.0.0/24", "gateway": "10.251.0.1"},
        "members": [
            {"name": "pt-pg", "role": "postgres", "ip": "10.251.0.2", "image": archive("postgres:17-alpine", "pg"),
             "env": {"POSTGRES_PASSWORD": "platform-test"},
             "data": [{"root": "/var/lib/otterd/platform/pt-pg", "target": "/var/lib/postgresql/data"}],
             "readiness": {"kind": "exec", "argv": ["pg_isready", "-U", "postgres", "-h", "127.0.0.1"]}},
            {"name": "pt-redis", "role": "redis", "ip": "10.251.0.3", "image": archive("redis:7-alpine", "redis"),
             "readiness": {"kind": "tcp", "port": 6379}},
            {"name": "pt-cp", "role": "control-plane", "ip": "10.251.0.4", "image": archive("busybox:1.36", "cp"),
             "cmd": ["sh", "-c", "mkdir -p /www && echo ok > /www/health && exec httpd -f -p 3000 -h /www"],
             "env": {"ROLE": "control-plane"}, "recoveryEnv": {"OTTERDEPLOY_RECOVERY": "1"},
             "dependsOn": ["pt-pg", "pt-redis"], "readiness": {"kind": "http", "port": 3000, "path": "/health"}}
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
    let mut d = DockerClient::new("/var/run/docker.sock", Duration::from_secs(120));
    d.negotiate().await.unwrap();
    let engine = EngineAdapter::new(
        d,
        JournalHandle::new(journal),
        boot.parse().unwrap(),
        Incarnation::mint().unwrap(),
        "test".into(),
    );
    Platform::new(
        PlatformConfig {
            dir: dir.to_owned(),
            boot_barrier_profile: String::new(),
            ready_timeout: Duration::from_secs(120),
        },
        engine,
        PublicKey::from_verifying_key(&SigningKey::from_bytes(&RECOVERY).verifying_key()),
    )
}

fn creates(p: &Platform) -> usize {
    p.engine()
        .journal()
        .snapshot()
        .unwrap()
        .mutations
        .values()
        .filter(|m| {
            m.record.verb == EngineVerb::Create
                && matches!(
                    m.submission,
                    Submission::Settled {
                        outcome: EngineOutcome::Created { .. }
                    }
                )
        })
        .count()
}

fn running(name_part: &str) -> String {
    docker(&[
        "ps",
        "-q",
        "--filter",
        "label=dev.otterdeploy.class=platform",
        "--filter",
        &format!("name={name_part}"),
    ])
}

#[tokio::test]
#[ignore = "needs root, Docker and network access on Linux"]
async fn boots_continues_reloads_and_refuses() {
    cleanup();
    let dir = tempfile::tempdir().unwrap();
    let host = otterd_sys::host::host_binding(None).unwrap();
    let env = manifest(&host);

    // Install once; a second install is an update, not an install.
    let p = platform(dir.path()).await;
    p.install(&env, &host).await.unwrap();
    assert!(matches!(
        p.install(&env, &host).await,
        Err(PlatformError::Blocked(_))
    ));

    // Boot: Postgres and Redis before the control plane, each ready first.
    p.boot(&host, U53::ZERO, true).await.unwrap();
    let started = |n: &str| docker(&["inspect", "-f", "{{.State.StartedAt}}", &running(n)]);
    let (pg, redis, cp) = (
        started("platform-pt-pg"),
        started("platform-pt-redis"),
        started("platform-pt-cp"),
    );
    assert!(
        pg < cp && redis < cp,
        "dependencies first: {pg} {redis} {cp}"
    );
    let cp_env = docker(&[
        "inspect",
        "-f",
        "{{json .Config.Env}}",
        &running("platform-pt-cp"),
    ]);
    assert!(
        cp_env.contains("OTTERDEPLOY_RECOVERY=1"),
        "recovery mode environment"
    );
    assert_eq!(
        docker(&[
            "inspect",
            "-f",
            "{{.HostConfig.RestartPolicy.Name}}",
            &running("platform-pt-cp")
        ]),
        "no"
    );
    assert_eq!(creates(&p), 3);
    assert_eq!(p.status().phase, "up");
    drop(p);

    // A daemon restart: the ready members are continued, not restarted.
    let p = platform(dir.path()).await;
    p.boot(&host, U53::ZERO, true).await.unwrap();
    assert_eq!(creates(&p), 3, "no new attempts");
    assert!(
        p.status()
            .members
            .values()
            .all(|s| s == "ready (continued)")
    );
    assert_eq!(started("platform-pt-cp"), cp);

    // The control plane's container and image are gone: a new attempt from the
    // signed local archive, never a registry.
    docker(&["rm", "-f", &running("platform-pt-cp")]);
    docker(&["rmi", "-f", "busybox:1.36"]);
    p.boot(&host, U53::ZERO, false).await.unwrap();
    assert_eq!(creates(&p), 4);
    assert!(
        p.status().events.iter().any(|e| e.contains("loaded")),
        "{:?}",
        p.status().events
    );
    let cp_env = docker(&[
        "inspect",
        "-f",
        "{{json .Config.Env}}",
        &running("platform-pt-cp"),
    ]);
    assert!(
        !cp_env.contains("OTTERDEPLOY_RECOVERY"),
        "normal mode this time"
    );

    // A tampered archive is refused before anything starts.
    docker(&["rm", "-f", &running("platform-pt-cp")]);
    docker(&["rmi", "-f", "busybox:1.36"]);
    let tar = format!("{IMAGES}/cp.tar");
    let original = std::fs::read(&tar).unwrap();
    let mut tampered = original.clone();
    tampered.extend_from_slice(b"x");
    std::fs::write(&tar, &tampered).unwrap();
    let r = p.boot(&host, U53::ZERO, false).await;
    std::fs::write(&tar, &original).unwrap();
    assert!(
        matches!(&r, Err(PlatformError::Blocked(m)) if m.contains("checksum")),
        "{r:?}"
    );
    assert_eq!(p.status().phase, "blocked");

    // The recovery root revoked every term below 5: this manifest (term 2) may not boot.
    let r = p.boot(&host, U53::from_const(5), false).await;
    assert!(
        matches!(&r, Err(PlatformError::Blocked(m)) if m.contains("revoked")),
        "{r:?}"
    );

    // Another machine's manifest is refused at install.
    let other = tempfile::tempdir().unwrap();
    let q = platform(other.path()).await;
    let mut elsewhere = host.clone();
    elsewhere.machine_id = "another-machine".into();
    assert!(q.install(&manifest(&elsewhere), &host).await.is_err());

    cleanup();
}
