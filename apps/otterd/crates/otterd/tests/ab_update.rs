//! A/B updates through the packaged unit and the independent guard: a good
//! release is tried and commits itself once healthy; a broken release fails
//! its boot budget and the guard rolls back to the previous slot; tampered or
//! unsigned releases never stage; release keys rotate only by a current key.
//! Ignored by default; run as root on a Linux host with systemd and Docker,
//! after building the guard:
//!
//! ```sh
//! cargo build -p otterd-update
//! cargo test -p otterd --test ab_update -- --ignored
//! ```
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::too_many_lines
)]

use ed25519_dalek::SigningKey;
use otterd_proto::U53;
use otterd_proto::envelope::{PublicKey, SignContext, SignedEnvelope};
use otterd_proto::identity::{EnrollCertificate, HostBinding, NodeRole, TrustedKey};
use otterd_proto::ids::Sha256Hex;
use otterd_proto::release::{ReleaseArtifact, ReleaseKey, ReleaseKeySet, ReleaseManifest};
use otterd_proto::version::VersionRange;
use std::os::unix::fs::PermissionsExt as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{Duration, Instant};

const BASE: &str = "/var/lib/otterd-ab-test";
const UNIT: &str = "otterd-ab-test.service";
const RELEASE: [u8; 32] = [5; 32];
const RELEASE2: [u8; 32] = [6; 32];

fn p(rest: &str) -> PathBuf {
    Path::new(BASE).join(rest)
}

fn show(prop: &str) -> String {
    let o = Command::new("systemctl")
        .args(["show", "-P", prop, UNIT])
        .output()
        .unwrap();
    String::from_utf8_lossy(&o.stdout).trim().to_owned()
}

fn otterd(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_otterd"))
        .args(args)
        .env("OTTERD_UPDATE_ROOT", p("lib"))
        .env("OTTERD_RELEASE_KEYS", p("release-keys.json"))
        .env("OTTERD_JOURNAL", p("journal/node.journal"))
        .env("OTTERD_KEYS_DIR", p("keys"))
        .output()
        .unwrap()
}

fn ok(args: &[&str]) -> serde_json::Value {
    let o = otterd(args);
    assert!(
        o.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&o.stderr)
    );
    serde_json::from_slice(&o.stdout).unwrap_or(serde_json::Value::Null)
}

fn release(name: &str, version: &str, binary: &Path, signer: [u8; 32]) -> PathBuf {
    let bytes = std::fs::read(binary).unwrap();
    let r = ReleaseManifest {
        version: version.into(),
        artifacts: vec![ReleaseArtifact {
            arch: std::env::consts::ARCH.into(),
            sha256: Sha256Hex::digest(&bytes),
            size: U53::new(u64::try_from(bytes.len()).unwrap()).unwrap(),
        }],
        protocol: VersionRange { min: 1, max: 1 },
        journal_format: otterd_proto::version::JOURNAL_FORMAT,
        min_rollback_version: "1.0.0".into(),
        issued_at_unix_ms: otterd_journal::now_unix_ms(),
    };
    let path = p(&format!("{name}.json"));
    let env = SignedEnvelope::sign(
        &SigningKey::from_bytes(&signer),
        SignContext::ReleaseManifest,
        &r,
    )
    .unwrap();
    std::fs::write(&path, serde_json::to_vec(&env).unwrap()).unwrap();
    path
}

fn state() -> serde_json::Value {
    ok(&["update", "status"])
}

fn wait(what: &str, within: Duration, mut f: impl FnMut() -> bool) {
    let deadline = Instant::now() + within;
    while !f() {
        assert!(
            Instant::now() < deadline,
            "timed out waiting for {what}: {} / {}",
            show("ActiveState"),
            state()
        );
        std::thread::sleep(Duration::from_millis(500));
    }
}

fn enroll() {
    let printed = ok(&["keygen"]);
    let identity: PublicKey = serde_json::from_value(printed["keys"]["identity"].clone()).unwrap();
    let cp = SigningKey::from_bytes(&[7; 32]);
    let cert = EnrollCertificate {
        install_id: "inst_ab".parse().unwrap(),
        node_id: "node-ab".parse().unwrap(),
        node_epoch: U53::ONE,
        authority_term: U53::ONE,
        roles: vec![NodeRole::Worker],
        identity_key_id: identity.key_id(),
        key_epoch: U53::ONE,
        host: HostBinding {
            machine_id: "m".into(),
            product_uuid: None,
            provider: None,
        },
        cp_keys: vec![TrustedKey {
            key: PublicKey::from_verifying_key(&cp.verifying_key()),
            epoch: U53::ONE,
            not_after_unix_ms: None,
        }],
        recovery_key: PublicKey::from_bytes([9; 32]),
        control_url: "wss://cp.invalid/api/otterd/connect".into(),
        anchor: None,
        issued_at_unix_ms: otterd_journal::now_unix_ms(),
        reason: "initial".into(),
    };
    std::fs::write(
        p("cert.json"),
        serde_json::to_vec(&SignedEnvelope::sign(&cp, SignContext::Enroll, &cert).unwrap())
            .unwrap(),
    )
    .unwrap();
    let cp_b64: String = serde_json::from_value(
        serde_json::to_value(PublicKey::from_verifying_key(&cp.verifying_key())).unwrap(),
    )
    .unwrap();
    ok(&[
        "init",
        "--certificate",
        p("cert.json").to_str().unwrap(),
        "--cp-key",
        &cp_b64,
    ]);
}

#[test]
#[ignore = "needs root, systemd and Docker on Linux, and a built otterd-guard"]
fn a_good_release_commits_and_a_broken_one_rolls_back() {
    let guard = Path::new(env!("CARGO_BIN_EXE_otterd")).with_file_name("otterd-guard");
    assert!(
        guard.exists(),
        "build otterd-update first: {}",
        guard.display()
    );
    let _ = Command::new("systemctl").args(["stop", UNIT]).status();
    let _ = std::fs::remove_dir_all(BASE);
    std::fs::create_dir_all(BASE).unwrap();
    std::fs::set_permissions(BASE, std::fs::Permissions::from_mode(0o700)).unwrap();
    let key = |seed: [u8; 32]| ReleaseKey {
        key: PublicKey::from_verifying_key(&SigningKey::from_bytes(&seed).verifying_key()),
        not_before_unix_ms: None,
        not_after_unix_ms: None,
    };
    std::fs::write(
        p("release-keys.json"),
        serde_json::to_vec(&ReleaseKeySet {
            serial: U53::ONE,
            keys: vec![key(RELEASE)],
        })
        .unwrap(),
    )
    .unwrap();
    std::fs::set_permissions(
        p("release-keys.json"),
        std::fs::Permissions::from_mode(0o600),
    )
    .unwrap();
    enroll();

    let good = PathBuf::from(env!("CARGO_BIN_EXE_otterd"));
    let broken = p("broken-otterd");
    std::fs::write(&broken, "#!/bin/sh\necho broken release >&2\nexit 3\n").unwrap();
    std::fs::set_permissions(&broken, std::fs::Permissions::from_mode(0o755)).unwrap();

    ok(&[
        "update",
        "install",
        "--release",
        release("r100", "1.0.0", &good, RELEASE).to_str().unwrap(),
        "--binary",
        good.to_str().unwrap(),
    ]);
    std::fs::copy(&guard, p("lib/otterd-guard")).unwrap();
    std::fs::write(p("otterd.env"), format!(
        "OTTERD_JOURNAL={}\nOTTERD_KEYS_DIR={}\nOTTERD_SOCKET={}\nOTTERD_STAGING_ROOT={}\nOTTERD_UPDATE_ROOT={}\nOTTERD_RECONCILE_MS=500\n",
        p("journal/node.journal").display(), p("keys").display(), p("run/otterd.sock").display(), p("stage").display(), p("lib").display())).unwrap();
    let unit = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packaging/systemd/otterd.service"
    ))
    .unwrap()
    .replace(
        "ExecStartPre=/usr/lib/otterd/otterd-guard",
        &format!("ExecStartPre={}", p("lib/otterd-guard").display()),
    )
    .replace(
        "ExecStart=/usr/lib/otterd/current/otterd run",
        &format!("ExecStart={} run", p("lib/current/otterd").display()),
    )
    .replace(
        "EnvironmentFile=-/etc/otterd/otterd.env",
        &format!("EnvironmentFile={}", p("otterd.env").display()),
    )
    .replace(
        "[Service]",
        &format!(
            "[Service]\nEnvironment=OTTERD_UPDATE_ROOT={}",
            p("lib").display()
        ),
    );
    let unit_path = Path::new("/run/systemd/system").join(UNIT);
    std::fs::write(&unit_path, unit).unwrap();
    assert!(
        Command::new("systemctl")
            .arg("daemon-reload")
            .status()
            .unwrap()
            .success()
    );
    assert!(
        Command::new("systemctl")
            .args(["start", UNIT])
            .status()
            .unwrap()
            .success()
    );
    assert_eq!(state()["active"], "a");

    // Refused before staging: a tampered binary, an unknown signer.
    let o = otterd(&[
        "update",
        "stage",
        "--release",
        release("r110", "1.1.0", &good, RELEASE).to_str().unwrap(),
        "--binary",
        broken.to_str().unwrap(),
    ]);
    assert!(!o.status.success(), "tampered binary staged");
    let o = otterd(&[
        "update",
        "stage",
        "--release",
        release("rx", "1.1.0", &good, [8; 32]).to_str().unwrap(),
        "--binary",
        good.to_str().unwrap(),
    ]);
    assert!(!o.status.success(), "unknown release key accepted");

    // A good release: tried at the next start, commits itself once healthy.
    ok(&[
        "update",
        "stage",
        "--release",
        p("r110.json").to_str().unwrap(),
        "--binary",
        good.to_str().unwrap(),
    ]);
    assert!(
        Command::new("systemctl")
            .args(["restart", UNIT])
            .status()
            .unwrap()
            .success()
    );
    wait(
        "the good release to commit",
        Duration::from_secs(30),
        || {
            let s = state();
            s["active"] == "b" && s["pending"].is_null()
        },
    );

    // Release keys rotate only when a current key signs the new set.
    let next = ReleaseKeySet {
        serial: U53::from_const(2),
        keys: vec![key(RELEASE2)],
    };
    std::fs::write(
        p("keys-by-new.json"),
        serde_json::to_vec(
            &SignedEnvelope::sign(
                &SigningKey::from_bytes(&RELEASE2),
                SignContext::ReleaseKeys,
                &next,
            )
            .unwrap(),
        )
        .unwrap(),
    )
    .unwrap();
    assert!(
        !otterd(&[
            "update",
            "rotate-keys",
            "--replacement",
            p("keys-by-new.json").to_str().unwrap()
        ])
        .status
        .success()
    );
    std::fs::write(
        p("keys-by-old.json"),
        serde_json::to_vec(
            &SignedEnvelope::sign(
                &SigningKey::from_bytes(&RELEASE),
                SignContext::ReleaseKeys,
                &next,
            )
            .unwrap(),
        )
        .unwrap(),
    )
    .unwrap();
    ok(&[
        "update",
        "rotate-keys",
        "--replacement",
        p("keys-by-old.json").to_str().unwrap(),
    ]);
    let o = otterd(&[
        "update",
        "stage",
        "--release",
        release("old-key", "1.2.0", &broken, RELEASE)
            .to_str()
            .unwrap(),
        "--binary",
        broken.to_str().unwrap(),
    ]);
    assert!(!o.status.success(), "the retired release key still signs");

    // A broken release, signed by the new key: it fails its boot budget, the
    // guard puts the previous slot back, and the node runs again.
    let restarts_before: u32 = show("NRestarts").parse().unwrap();
    ok(&[
        "update",
        "stage",
        "--release",
        release("r120", "1.2.0", &broken, RELEASE2)
            .to_str()
            .unwrap(),
        "--binary",
        broken.to_str().unwrap(),
    ]);
    let _ = Command::new("systemctl").args(["restart", UNIT]).status();
    wait("the rollback", Duration::from_secs(90), || {
        let s = state();
        show("ActiveState") == "active"
            && s["active"] == "b"
            && s["pending"].is_null()
            && s["rolledBack"].is_string()
    });
    assert_eq!(
        std::fs::read_link(p("lib/current")).unwrap(),
        Path::new("b")
    );
    let restarts: u32 = show("NRestarts").parse().unwrap();
    assert!(
        restarts >= restarts_before + 3,
        "the broken release used its boot budget: {restarts}"
    );
    println!("rolled back: {}", state()["rolledBack"]);

    let _ = Command::new("systemctl").args(["stop", UNIT]).status();
    let _ = std::fs::remove_file(&unit_path);
    let _ = Command::new("systemctl").arg("daemon-reload").status();
}
