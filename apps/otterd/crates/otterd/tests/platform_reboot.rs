//! N=1 cold boot: the packaged unit runs `otterd run --platform`, the host is
//! rebooted, and the platform comes back from its signed manifest and local
//! archives with no control plane and no registry, before the tenant gate
//! opens. Two phases around a reboot, as root on a Linux host with systemd and
//! Docker:
//!
//! ```sh
//! OTTERD_REBOOT_PHASE=prepare cargo test -p otterd --test platform_reboot -- --ignored
//! reboot
//! OTTERD_REBOOT_PHASE=verify cargo test -p otterd --test platform_reboot -- --ignored
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
use otterd_proto::identity::{EnrollCertificate, NodeRole, TrustedKey};
use otterd_proto::ids::Sha256Hex;
use std::io::{Read as _, Write as _};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

const BASE: &str = "/var/lib/otterd-reboot-test";
const UNIT: &str = "otterd-reboot-test.service";
const RECOVERY: [u8; 32] = [3; 32];
const CP: [u8; 32] = [7; 32];

fn sh(cmd: &str, args: &[&str]) -> String {
    let out = Command::new(cmd).args(args).output().unwrap();
    String::from_utf8_lossy(&out.stdout).trim().to_owned()
}

fn p(rest: &str) -> String {
    format!("{BASE}/{rest}")
}

fn status() -> Option<serde_json::Value> {
    let mut s = UnixStream::connect(p("run/otterd.sock")).ok()?;
    s.write_all(b"GET /status HTTP/1.1\r\nHost: otterd\r\nConnection: close\r\n\r\n")
        .ok()?;
    let mut text = String::new();
    s.read_to_string(&mut text).ok()?;
    serde_json::from_str(text.split_once("\r\n\r\n")?.1).ok()
}

fn wait_platform_up(within: Duration) -> serde_json::Value {
    let deadline = Instant::now() + within;
    loop {
        if let Some(s) = status()
            && s["tenantGate"]["open"] == true
            && s["tenantGate"]["reason"] == "platform up"
        {
            return s;
        }
        assert!(Instant::now() < deadline, "platform not up: {:?}", status());
        std::thread::sleep(Duration::from_secs(1));
    }
}

fn members() -> Vec<String> {
    let ids = sh(
        "docker",
        &[
            "ps",
            "-q",
            "--filter",
            "label=dev.otterdeploy.class=platform",
            "--filter",
            "name=prb-",
        ],
    );
    let mut v: Vec<String> = ids.split_whitespace().map(str::to_owned).collect();
    v.sort();
    v
}

fn archive(reference: &str, name: &str) -> serde_json::Value {
    sh("docker", &["pull", "-q", reference]);
    std::fs::create_dir_all(p("images")).unwrap();
    let path = p(&format!("images/{name}.tar"));
    assert!(
        Command::new("docker")
            .args(["save", "-o", &path, reference])
            .status()
            .unwrap()
            .success()
    );
    serde_json::json!({"reference": reference, "id": sh("docker", &["image", "inspect", "-f", "{{.Id}}", reference]),
        "archive": path, "archiveSha256": Sha256Hex::digest(&std::fs::read(&path).unwrap())})
}

fn prepare() {
    let _ = Command::new("systemctl")
        .args(["disable", "--now", UNIT])
        .status();
    for c in sh(
        "docker",
        &[
            "ps",
            "-aq",
            "--filter",
            "label=dev.otterdeploy.class=platform",
        ],
    )
    .split_whitespace()
    {
        sh("docker", &["rm", "-f", c]);
    }
    sh("docker", &["network", "rm", "otterd-prb"]);
    let _ = std::fs::remove_dir_all(BASE);
    let _ = std::fs::remove_dir_all("/var/lib/otterd/platform/prb-pg");
    std::fs::create_dir_all(BASE).unwrap();
    let bin = p("otterd");
    std::fs::copy(env!("CARGO_BIN_EXE_otterd"), &bin).unwrap();
    let env_file = p("otterd.env");
    std::fs::write(&env_file, format!(
        "OTTERD_JOURNAL={}\nOTTERD_KEYS_DIR={}\nOTTERD_BOOTSTRAP_DIR={}\nOTTERD_SOCKET={}\nOTTERD_STAGING_ROOT={}\nOTTERD_PLATFORM=true\nOTTERD_PLATFORM_RECOVERY=true\n",
        p("journal/node.journal"), p("keys"), p("bootstrap"), p("run/otterd.sock"), p("stage"))).unwrap();
    let otterd = |args: &[&str]| {
        let mut c = Command::new(&bin);
        c.args(args)
            .env("OTTERD_JOURNAL", p("journal/node.journal"))
            .env("OTTERD_KEYS_DIR", p("keys"))
            .env("OTTERD_BOOTSTRAP_DIR", p("bootstrap"));
        let o = c.output().unwrap();
        assert!(
            o.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&o.stderr)
        );
        o.stdout
    };
    let printed: serde_json::Value = serde_json::from_slice(&otterd(&["keygen"])).unwrap();
    let identity: PublicKey = serde_json::from_value(printed["keys"]["identity"].clone()).unwrap();
    let cp = SigningKey::from_bytes(&CP);
    let recovery = SigningKey::from_bytes(&RECOVERY);
    let host = otterd_sys::host::host_binding(None).unwrap();
    let cert = EnrollCertificate {
        install_id: "inst_prb".parse().unwrap(),
        node_id: "node-prb".parse().unwrap(),
        node_epoch: U53::ONE,
        authority_term: U53::from_const(2),
        roles: vec![NodeRole::Platform],
        identity_key_id: identity.key_id(),
        key_epoch: U53::ONE,
        host: host.clone(),
        cp_keys: vec![TrustedKey {
            key: PublicKey::from_verifying_key(&cp.verifying_key()),
            epoch: U53::ONE,
            not_after_unix_ms: None,
        }],
        recovery_key: PublicKey::from_verifying_key(&recovery.verifying_key()),
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
    otterd(&[
        "init",
        "--certificate",
        &p("cert.json"),
        "--cp-key",
        &cp_b64,
    ]);

    let manifest: otterd_proto::platform::PlatformBootManifest = serde_json::from_value(serde_json::json!({
        "schema": 1, "installId": "inst_prb", "host": host,
        "bootstrapEpoch": 1, "manifestRevision": 1, "authorityTerm": 2,
        "network": {"name": "otterd-prb", "subnet": "10.252.0.0/24", "gateway": "10.252.0.1"},
        "members": [
            {"name": "prb-pg", "role": "postgres", "ip": "10.252.0.2", "image": archive("postgres:17-alpine", "pg"),
             "env": {"POSTGRES_PASSWORD": "platform-test"},
             "data": [{"root": "/var/lib/otterd/platform/prb-pg", "target": "/var/lib/postgresql/data"}],
             "readiness": {"kind": "exec", "argv": ["pg_isready", "-U", "postgres", "-h", "127.0.0.1"]}},
            {"name": "prb-redis", "role": "redis", "ip": "10.252.0.3", "image": archive("redis:7-alpine", "redis"),
             "readiness": {"kind": "tcp", "port": 6379}},
            {"name": "prb-cp", "role": "control-plane", "ip": "10.252.0.4", "image": archive("busybox:1.36", "cp"),
             "cmd": ["sh", "-c", "mkdir -p /www && echo ok > /www/health && exec httpd -f -p 3000 -h /www"],
             "dependsOn": ["prb-pg", "prb-redis"], "readiness": {"kind": "http", "port": 3000, "path": "/health"}}
        ]
    })).unwrap();
    std::fs::write(
        p("manifest.json"),
        serde_json::to_vec(
            &SignedEnvelope::sign(&recovery, SignContext::PlatformBootManifest, &manifest).unwrap(),
        )
        .unwrap(),
    )
    .unwrap();
    otterd(&["platform", "install", "--manifest", &p("manifest.json")]);

    let unit = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packaging/systemd/otterd.service"
    ))
    .unwrap()
    .replace(
        "ExecStart=/usr/local/bin/otterd run",
        &format!("ExecStart={bin} run"),
    )
    .replace(
        "EnvironmentFile=-/etc/otterd/otterd.env",
        &format!("EnvironmentFile={env_file}"),
    );
    std::fs::write(Path::new("/etc/systemd/system").join(UNIT), unit).unwrap();
    assert!(
        Command::new("systemctl")
            .arg("daemon-reload")
            .status()
            .unwrap()
            .success()
    );
    assert!(
        Command::new("systemctl")
            .args(["enable", "--now", UNIT])
            .status()
            .unwrap()
            .success()
    );
    let s = wait_platform_up(Duration::from_secs(300));
    std::fs::write(
        p("before.json"),
        serde_json::json!({"members": members(), "incarnation": s["incarnation"],
        "bootId": sh("cat", &["/proc/sys/kernel/random/boot_id"])})
        .to_string(),
    )
    .unwrap();
    println!(
        "prepared: {}",
        std::fs::read_to_string(p("before.json")).unwrap()
    );
}

fn verify() {
    let before: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(p("before.json")).unwrap()).unwrap();
    assert_ne!(
        before["bootId"],
        sh("cat", &["/proc/sys/kernel/random/boot_id"]),
        "the host rebooted"
    );
    let s = wait_platform_up(Duration::from_secs(300));
    assert_ne!(s["incarnation"], before["incarnation"]);
    let now = members();
    assert_eq!(now.len(), 3, "all three members run again");
    for old in before["members"].as_array().unwrap() {
        assert!(
            !now.contains(&old.as_str().unwrap().to_owned()),
            "members are new attempts after a reboot"
        );
    }
    let stale = sh(
        "docker",
        &[
            "ps",
            "-aq",
            "--filter",
            "label=dev.otterdeploy.class=platform",
            "--filter",
            "status=exited",
        ],
    );
    assert!(
        stale.is_empty(),
        "the pre-reboot attempts were removed: {stale}"
    );
    println!("verified: members {now:?}");
    let _ = Command::new("systemctl")
        .args(["disable", "--now", UNIT])
        .status();
    let _ = std::fs::remove_file(Path::new("/etc/systemd/system").join(UNIT));
    let _ = Command::new("systemctl").arg("daemon-reload").status();
    for c in sh(
        "docker",
        &[
            "ps",
            "-aq",
            "--filter",
            "label=dev.otterdeploy.class=platform",
        ],
    )
    .split_whitespace()
    {
        sh("docker", &["rm", "-f", c]);
    }
    sh("docker", &["network", "rm", "otterd-prb"]);
}

#[test]
#[ignore = "reboots the host: two phases, see the module docs"]
fn the_platform_comes_back_after_a_cold_boot() {
    match std::env::var("OTTERD_REBOOT_PHASE").as_deref() {
        Ok("prepare") => prepare(),
        Ok("verify") => verify(),
        other => panic!("set OTTERD_REBOOT_PHASE to prepare or verify, got {other:?}"),
    }
}
