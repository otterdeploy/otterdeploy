//! The packaged systemd unit with the real binary: notify readiness, a
//! progress-tied watchdog that restarts a hung daemon into a new incarnation,
//! and no restart loop when the journal is gone. Ignored by default; run as
//! root on a Linux host with systemd and Docker:
//!
//! ```sh
//! cargo test -p otterd --test systemd_unit -- --ignored
//! ```
#![allow(
    clippy::unwrap_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::too_many_lines
)]

use ed25519_dalek::SigningKey;
use otterd_proto::U53;
use otterd_proto::envelope::{PublicKey, SignContext, SignedEnvelope};
use otterd_proto::identity::{EnrollCertificate, HostBinding, NodeRole, TrustedKey};
use std::io::{Read as _, Write as _};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

const UNIT: &str = "otterd-unit-test.service";

fn sh(cmd: &str, args: &[&str]) -> String {
    let out = Command::new(cmd).args(args).output().unwrap();
    String::from_utf8_lossy(&out.stdout).trim().to_owned()
}

fn show(prop: &str) -> String {
    sh("systemctl", &["show", "-P", prop, UNIT])
}

fn wait_for(what: &str, within: Duration, mut f: impl FnMut() -> bool) {
    let deadline = Instant::now() + within;
    while !f() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(200));
    }
}

fn status(socket: &Path) -> serde_json::Value {
    let mut s = UnixStream::connect(socket).unwrap();
    s.write_all(b"GET /status HTTP/1.1\r\nHost: otterd\r\nConnection: close\r\n\r\n")
        .unwrap();
    let mut text = String::new();
    s.read_to_string(&mut text).unwrap();
    serde_json::from_str(text.split_once("\r\n\r\n").unwrap().1).unwrap()
}

struct Cleanup(PathBuf);

impl Drop for Cleanup {
    fn drop(&mut self) {
        let _ = Command::new("systemctl").args(["stop", UNIT]).status();
        let _ = Command::new("systemctl")
            .args(["reset-failed", UNIT])
            .status();
        let _ = std::fs::remove_file(&self.0);
        let _ = Command::new("systemctl").arg("daemon-reload").status();
    }
}

#[test]
#[ignore = "needs root, systemd and Docker on Linux"]
fn the_unit_notifies_restarts_a_hung_daemon_and_stops_on_lost_journal() {
    let root = tempfile::Builder::new()
        .prefix("otterd-unit-")
        .tempdir_in("/var/tmp")
        .unwrap();
    let t = root.path();
    let bin = t.join("otterd");
    std::fs::copy(env!("CARGO_BIN_EXE_otterd"), &bin).unwrap();
    let env_file = t.join("otterd.env");
    let socket = t.join("run/otterd.sock");
    let journal = t.join("journal/node.journal");
    std::fs::write(
        &env_file,
        format!(
            "OTTERD_JOURNAL={}\nOTTERD_KEYS_DIR={}\nOTTERD_SOCKET={}\nOTTERD_STAGING_ROOT={}\nOTTERD_RECONCILE_MS=500\n",
            journal.display(),
            t.join("keys").display(),
            socket.display(),
            t.join("stage").display(),
        ),
    )
    .unwrap();
    let with_env = |args: &[&str]| {
        let mut c = Command::new(&bin);
        c.args(args)
            .env("OTTERD_KEYS_DIR", t.join("keys"))
            .env("OTTERD_JOURNAL", &journal);
        c.output().unwrap()
    };

    // Enrollment, as an installer would do it.
    let o = with_env(&["keygen"]);
    assert!(o.status.success());
    let printed: serde_json::Value = serde_json::from_slice(&o.stdout).unwrap();
    let identity: PublicKey = serde_json::from_value(printed["keys"]["identity"].clone()).unwrap();
    let cp = SigningKey::from_bytes(&[7; 32]);
    let cert = EnrollCertificate {
        install_id: "inst".parse().unwrap(),
        node_id: "node-unit".parse().unwrap(),
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
    let cert_path = t.join("cert.json");
    std::fs::write(
        &cert_path,
        serde_json::to_vec(&SignedEnvelope::sign(&cp, SignContext::Enroll, &cert).unwrap())
            .unwrap(),
    )
    .unwrap();
    let cp_b64: String = serde_json::from_value(
        serde_json::to_value(PublicKey::from_verifying_key(&cp.verifying_key())).unwrap(),
    )
    .unwrap();
    let o = with_env(&[
        "init",
        "--certificate",
        cert_path.to_str().unwrap(),
        "--cp-key",
        &cp_b64,
    ]);
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));

    // The packaged unit, pointed at this tree, with short timers.
    let unit = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packaging/systemd/otterd.service"
    ))
    .unwrap()
    .replace(
        "ExecStart=/usr/local/bin/otterd run",
        &format!("ExecStart={} run", bin.display()),
    )
    .replace(
        "EnvironmentFile=-/etc/otterd/otterd.env",
        &format!("EnvironmentFile={}", env_file.display()),
    )
    .replace("WatchdogSec=30s", "WatchdogSec=4s")
    .replace("TimeoutStopSec=20s", "TimeoutStopSec=5s");
    assert!(unit.contains("Type=notify") && unit.contains("RestartPreventExitStatus=2"));
    let unit_path = PathBuf::from("/run/systemd/system").join(UNIT);
    std::fs::write(&unit_path, unit).unwrap();
    let _cleanup = Cleanup(unit_path);
    assert!(
        Command::new("systemctl")
            .arg("daemon-reload")
            .status()
            .unwrap()
            .success()
    );

    // Type=notify: start returns once the daemon said READY.
    assert!(
        Command::new("systemctl")
            .args(["start", UNIT])
            .status()
            .unwrap()
            .success()
    );
    assert_eq!(show("ActiveState"), "active");
    assert_eq!(show("WatchdogUSec"), "4s");
    let first = status(&socket);
    let first_incarnation = first["incarnation"].clone();

    // A healthy daemon outlives several watchdog periods.
    std::thread::sleep(Duration::from_secs(10));
    assert_eq!(show("ActiveState"), "active");
    assert_eq!(show("NRestarts"), "0", "the watchdog was petted");
    assert!(status(&socket)["progress"]["pets"].as_u64().unwrap() >= 3);

    // A hung daemon (stopped, so no pass completes and no pet is sent) is
    // restarted, into a new incarnation and boot quarantine.
    let pid = show("MainPID");
    assert!(
        Command::new("kill")
            .args(["-STOP", &pid])
            .status()
            .unwrap()
            .success()
    );
    wait_for("a watchdog restart", Duration::from_secs(40), || {
        show("NRestarts") == "1" && show("ActiveState") == "active" && show("MainPID") != pid
    });
    wait_for("the control socket", Duration::from_secs(10), || {
        UnixStream::connect(&socket).is_ok()
    });
    assert_ne!(status(&socket)["incarnation"], first_incarnation);

    // A lost journal: exit 2 and no restart loop.
    assert!(
        Command::new("systemctl")
            .args(["stop", UNIT])
            .status()
            .unwrap()
            .success()
    );
    std::fs::remove_file(&journal).unwrap();
    assert!(
        !Command::new("systemctl")
            .args(["start", UNIT])
            .status()
            .unwrap()
            .success()
    );
    std::thread::sleep(Duration::from_secs(6));
    assert_eq!(show("ActiveState"), "failed");
    assert_eq!(show("ExecMainStatus"), "2");
    assert_eq!(
        show("NRestarts"),
        "0",
        "restart counter reset by the manual start; no automatic restart"
    );
}
