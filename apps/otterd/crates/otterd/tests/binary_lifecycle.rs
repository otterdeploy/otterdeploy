//! The `otterd` binary end to end: key generation, enrollment, run, the local
//! status socket, the exclusive journal lock, and key-epoch recovery after a
//! rotation interrupted between the journal and the key store. Ignored by
//! default; run as root on a Linux host with Docker:
//!
//! ```sh
//! cargo test -p otterd --test binary_lifecycle -- --ignored
//! ```
#![allow(clippy::unwrap_used, clippy::panic, clippy::indexing_slicing)]

use base64::Engine as _;
use ed25519_dalek::SigningKey;
use otterd_identity::KeyStore;
use otterd_journal::Journal;
use otterd_proto::U53;
use otterd_proto::envelope::{PublicKey, SignContext, SignedEnvelope};
use otterd_proto::identity::{EnrollCertificate, HostBinding, NodeRole, TrustedKey};
use otterd_proto::journal::Record;
use std::io::{Read as _, Write as _};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output};
use std::time::{Duration, Instant};

const BIN: &str = env!("CARGO_BIN_EXE_otterd");

struct Dirs {
    _root: tempfile::TempDir,
    keys: PathBuf,
    journal: PathBuf,
    socket: PathBuf,
    stage: PathBuf,
}

impl Dirs {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let p = root.path().to_owned();
        Self {
            keys: p.join("keys"),
            journal: p.join("journal/node.journal"),
            socket: p.join("run/otterd.sock"),
            stage: p.join("stage"),
            _root: root,
        }
    }

    fn cmd(&self, args: &[&str]) -> Command {
        let mut c = Command::new(BIN);
        c.args(args)
            .env("OTTERD_KEYS_DIR", &self.keys)
            .env("OTTERD_JOURNAL", &self.journal)
            .env("OTTERD_SOCKET", &self.socket)
            .env("OTTERD_STAGING_ROOT", &self.stage)
            .env("OTTERD_RECONCILE_MS", "200");
        c
    }

    fn output(&self, args: &[&str]) -> Output {
        self.cmd(args).output().unwrap()
    }

    fn spawn_run(&self) -> Child {
        let _ = std::fs::remove_file(&self.socket);
        let child = self.cmd(&["run"]).spawn().unwrap();
        let deadline = Instant::now() + Duration::from_secs(20);
        while !self.socket.exists() {
            assert!(Instant::now() < deadline, "control socket never appeared");
            std::thread::sleep(Duration::from_millis(50));
        }
        child
    }

    fn status(&self) -> serde_json::Value {
        let mut s = UnixStream::connect(&self.socket).unwrap();
        s.write_all(b"GET /status HTTP/1.1\r\nHost: otterd\r\nConnection: close\r\n\r\n")
            .unwrap();
        let mut text = String::new();
        s.read_to_string(&mut text).unwrap();
        assert!(text.starts_with("HTTP/1.1 200"), "{text}");
        let body = text.split_once("\r\n\r\n").unwrap().1;
        serde_json::from_str(body).unwrap()
    }
}

fn terminate(mut child: Child) {
    let pid = child.id().to_string();
    assert!(
        Command::new("kill")
            .args(["-TERM", &pid])
            .status()
            .unwrap()
            .success()
    );
    let status = child.wait().unwrap();
    assert!(status.success(), "SIGTERM is a clean exit: {status}");
}

fn stderr(o: &Output) -> String {
    String::from_utf8_lossy(&o.stderr).into_owned()
}

fn certificate(cp: &SigningKey, identity: &PublicKey, key_epoch: u64) -> SignedEnvelope {
    let cert = EnrollCertificate {
        install_id: "inst".parse().unwrap(),
        node_id: "node-bin".parse().unwrap(),
        node_epoch: U53::ONE,
        authority_term: U53::ONE,
        roles: vec![NodeRole::Worker],
        identity_key_id: identity.key_id(),
        key_epoch: U53::new(key_epoch).unwrap(),
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
    SignedEnvelope::sign(cp, SignContext::Enroll, &cert).unwrap()
}

fn write_json(path: &Path, v: &impl serde::Serialize) {
    std::fs::write(path, serde_json::to_vec(v).unwrap()).unwrap();
}

#[test]
#[ignore = "needs root and Docker on Linux"]
fn keygen_init_run_and_key_epoch_recovery() {
    let d = Dirs::new();
    let cp = SigningKey::from_bytes(&[7; 32]);
    let cp_b64 = base64::engine::general_purpose::STANDARD.encode(cp.verifying_key().to_bytes());

    // Unenrolled: nothing runs.
    let o = d.output(&["run"]);
    assert_eq!(o.status.code(), Some(2), "{}", stderr(&o));

    // Keys: created once, never replaced.
    let o = d.output(&["keygen"]);
    assert!(o.status.success(), "{}", stderr(&o));
    let printed: serde_json::Value = serde_json::from_slice(&o.stdout).unwrap();
    let identity: PublicKey = serde_json::from_value(printed["keys"]["identity"].clone()).unwrap();
    assert!(!d.output(&["keygen"]).status.success());

    // Enrollment checks the certificate's signer, key and key epoch.
    let cert_path = d.keys.with_file_name("cert.json");
    let cp_arg = [
        "--certificate",
        cert_path.to_str().unwrap(),
        "--cp-key",
        &cp_b64,
    ];
    let init = |cert: &SignedEnvelope| {
        write_json(&cert_path, cert);
        d.output(&[&["init"][..], &cp_arg[..]].concat())
    };
    let o = init(&certificate(
        &SigningKey::from_bytes(&[8; 32]),
        &identity,
        1,
    ));
    assert!(!o.status.success(), "a certificate from another CP key");
    let o = init(&certificate(&cp, &PublicKey::from_bytes([5; 32]), 1));
    assert!(
        stderr(&o).contains("another identity key"),
        "{}",
        stderr(&o)
    );
    let o = init(&certificate(&cp, &identity, 2));
    assert!(stderr(&o).contains("key epoch"), "{}", stderr(&o));
    let o = init(&certificate(&cp, &identity, 1));
    assert!(o.status.success(), "{}", stderr(&o));
    assert!(
        !init(&certificate(&cp, &identity, 1)).status.success(),
        "a journal is never re-created"
    );

    // Run: status over the root-only socket; a second daemon cannot take the journal.
    let child = d.spawn_run();
    let mode = std::os::unix::fs::PermissionsExt::mode(
        &std::fs::metadata(&d.socket).unwrap().permissions(),
    );
    assert_eq!(mode & 0o777, 0o600);
    let s = d.status();
    assert_eq!(s["identity"]["keyEpoch"], 1);
    assert_eq!(s["engineReachable"], true);
    let o = d.output(&["run"]);
    assert!(
        !o.status.success() && stderr(&o).contains("locked"),
        "{}",
        stderr(&o)
    );
    std::thread::sleep(Duration::from_millis(600));
    assert!(d.status()["progress"]["passes"].as_u64().unwrap() >= 1);
    let first_incarnation = s["incarnation"].clone();
    terminate(child);

    // A rotation interrupted after the journal recorded it but before the key
    // store switched: the next start completes it.
    let store = KeyStore::new(&d.keys);
    let next = store.prepare_next().unwrap();
    {
        let (mut j, _) = Journal::open(&d.journal).unwrap();
        j.append(Record::KeysRotated {
            key_epoch: next.epoch(),
            identity_key_id: next.identity_public().key_id(),
        })
        .unwrap();
    }
    assert_eq!(store.current_epoch().unwrap(), Some(U53::ONE));
    let child = d.spawn_run();
    let s = d.status();
    assert_eq!(s["identity"]["keyEpoch"], 2);
    assert_ne!(
        s["incarnation"], first_incarnation,
        "every start is a new incarnation"
    );
    assert_eq!(store.current_epoch().unwrap(), Some(U53::from_const(2)));
    terminate(child);

    // The journal names an epoch the key store never prepared: recovery, exit 2.
    {
        let (mut j, _) = Journal::open(&d.journal).unwrap();
        j.append(Record::KeysRotated {
            key_epoch: U53::from_const(3),
            identity_key_id: PublicKey::from_bytes([6; 32]).key_id(),
        })
        .unwrap();
    }
    let o = d.output(&["run"]);
    assert_eq!(o.status.code(), Some(2), "{}", stderr(&o));
    assert!(stderr(&o).contains("recovery required"), "{}", stderr(&o));

    // A lost journal: exit 2.
    std::fs::remove_file(&d.journal).unwrap();
    assert_eq!(d.output(&["run"]).status.code(), Some(2));
}
