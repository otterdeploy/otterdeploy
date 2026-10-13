//! The recovery CLI against real journal files: keys, journal inspection,
//! offline authority revocation, and the manual fence flow.
#![allow(
    clippy::unwrap_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::too_many_lines
)]

use otterd_journal::Journal;
use otterd_proto::U53;
use otterd_proto::envelope::PublicKey;
use otterd_proto::identity::{HostBinding, TrustedKey};
use otterd_proto::journal::Record;
use serde_json::Value;
use std::os::unix::fs::PermissionsExt as _;
use std::path::Path;
use std::process::{Command, Output};

const BIN: &str = env!("CARGO_BIN_EXE_otterd-recover");

fn run(args: &[&str]) -> Output {
    Command::new(BIN).args(args).output().unwrap()
}

fn ok(args: &[&str]) -> Value {
    let o = run(args);
    assert!(
        o.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&o.stderr)
    );
    serde_json::from_slice(&o.stdout).unwrap()
}

fn err(args: &[&str]) -> String {
    let o = run(args);
    assert!(!o.status.success(), "{args:?} should fail");
    String::from_utf8_lossy(&o.stderr).into_owned()
}

fn journal_with(path: &Path, recovery: &PublicKey) {
    let mut j = Journal::create(path, "test").unwrap();
    j.append(Record::Identity {
        install_id: "inst".parse().unwrap(),
        node_id: "node-1".parse().unwrap(),
        node_epoch: U53::ONE,
        key_epoch: U53::ONE,
        identity_key_id: PublicKey::from_bytes([2; 32]).key_id(),
        cp_keys: vec![TrustedKey {
            key: PublicKey::from_bytes([1; 32]),
            epoch: U53::ONE,
            not_after_unix_ms: None,
        }],
        recovery_key: recovery.clone(),
        host: HostBinding {
            machine_id: "m".into(),
            product_uuid: None,
            provider: None,
        },
    })
    .unwrap();
}

#[test]
fn revoke_authority_offline_and_inspect_the_journal() {
    let dir = tempfile::tempdir().unwrap();
    let p = |n: &str| dir.path().join(n).to_str().unwrap().to_owned();
    let key = ok(&["keygen", "--out", &p("recovery.key")]);
    assert!(
        err(&["keygen", "--out", &p("recovery.key")]).contains("exists"),
        "never overwritten"
    );
    let mode = std::fs::metadata(p("recovery.key"))
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
    let recovery: PublicKey = serde_json::from_value(key["public"].clone()).unwrap();
    journal_with(Path::new(&p("node.journal")), &recovery);

    let before = ok(&["journal", "--path", &p("node.journal"), "--obligations"]);
    assert_eq!(before["revokedBelowTerm"], 0);
    assert_eq!(before["identity"]["nodeId"], "node-1");

    // Sign for this install; apply straight into the journal (daemon stopped).
    ok(&[
        "authority",
        "sign",
        "--key",
        &p("recovery.key"),
        "--install",
        "inst",
        "--below-term",
        "3",
        "--reason",
        "restored from backup",
        "--out",
        &p("revoke.json"),
    ]);
    let applied = ok(&[
        "authority",
        "apply",
        "--revocation",
        &p("revoke.json"),
        "--journal",
        &p("node.journal"),
    ]);
    assert_eq!(applied["revokedBelowTerm"], 3);
    let after = ok(&["journal", "--path", &p("node.journal"), "--obligations"]);
    assert_eq!(after["revokedBelowTerm"], 3);

    // Another node only: refused. Another key: refused. Revoking nothing: refused.
    ok(&[
        "authority",
        "sign",
        "--key",
        &p("recovery.key"),
        "--install",
        "inst",
        "--below-term",
        "4",
        "--node",
        "node-9",
        "--reason",
        "x",
        "--out",
        &p("other-node.json"),
    ]);
    assert!(
        err(&[
            "authority",
            "apply",
            "--revocation",
            &p("other-node.json"),
            "--journal",
            &p("node.journal")
        ])
        .contains("another install or node")
    );
    ok(&["keygen", "--out", &p("stranger.key")]);
    ok(&[
        "authority",
        "sign",
        "--key",
        &p("stranger.key"),
        "--install",
        "inst",
        "--below-term",
        "5",
        "--reason",
        "x",
        "--out",
        &p("stranger.json"),
    ]);
    assert!(
        !run(&[
            "authority",
            "apply",
            "--revocation",
            &p("stranger.json"),
            "--journal",
            &p("node.journal")
        ])
        .status
        .success()
    );
    assert!(
        err(&[
            "authority",
            "sign",
            "--key",
            &p("recovery.key"),
            "--install",
            "inst",
            "--below-term",
            "1",
            "--reason",
            "x",
            "--out",
            &p("nothing.json")
        ])
        .contains("revokes nothing")
    );
    assert_eq!(
        ok(&["journal", "--path", &p("node.journal"), "--obligations"])["revokedBelowTerm"],
        3
    );

    // A key file other users can read is refused.
    std::fs::set_permissions(p("recovery.key"), std::fs::Permissions::from_mode(0o644)).unwrap();
    assert!(
        err(&[
            "authority",
            "sign",
            "--key",
            &p("recovery.key"),
            "--install",
            "inst",
            "--below-term",
            "6",
            "--reason",
            "x",
            "--out",
            &p("x.json")
        ])
        .contains("0600")
    );
}

#[test]
fn manual_fence_flow_produces_barrier_evidence() {
    let dir = tempfile::tempdir().unwrap();
    let p = |n: &str| dir.path().join(n).to_str().unwrap().to_owned();
    let begun = ok(&["fence", "manual-begin", "--out", &p("fence.json")]);
    let challenge = begun["challenge"].as_str().unwrap().to_owned();
    std::fs::write(
        p("binding.json"),
        r#"{"provider":"manual","serverId":"srv-7","createdAt":"2026-01-01T00:00:00Z"}"#,
    )
    .unwrap();
    let now = otterd_journal::now_unix_ms().get();
    let proof = |c: &str, server: &str| {
        serde_json::json!({"assertedBy": "ops@example.com", "method": "bmc", "reference": "ipmi-sel-4411",
            "serverId": server, "observedOffAtUnixMs": now - 120_000, "challenge": c})
    };
    std::fs::write(p("proof.json"), proof(&challenge, "srv-7").to_string()).unwrap();
    let last_contact = (now - 300_000).to_string();
    let evidence = ok(&[
        "fence",
        "manual-verify",
        "--state",
        &p("fence.json"),
        "--binding",
        &p("binding.json"),
        "--proof",
        &p("proof.json"),
        "--last-contact-ms",
        &last_contact,
    ]);
    assert_eq!(evidence["method"], "manual-fence");
    std::fs::write(p("evidence.json"), evidence.to_string()).unwrap();
    let barrier = ok(&[
        "fence",
        "barrier",
        "--evidence",
        &p("evidence.json"),
        "--node-epoch",
        "3",
    ]);
    assert_eq!(barrier["nodeEpoch"], 3);
    assert_eq!(barrier["assertedBy"], "ops@example.com");

    // Wrong challenge, wrong machine, and a node heard from after the claimed off time.
    std::fs::write(p("bad.json"), proof("000000000000", "srv-7").to_string()).unwrap();
    assert!(
        err(&[
            "fence",
            "manual-verify",
            "--state",
            &p("fence.json"),
            "--binding",
            &p("binding.json"),
            "--proof",
            &p("bad.json"),
            "--last-contact-ms",
            &last_contact
        ])
        .contains("challenge")
    );
    std::fs::write(p("bad.json"), proof(&challenge, "srv-8").to_string()).unwrap();
    assert!(
        !run(&[
            "fence",
            "manual-verify",
            "--state",
            &p("fence.json"),
            "--binding",
            &p("binding.json"),
            "--proof",
            &p("bad.json"),
            "--last-contact-ms",
            &last_contact
        ])
        .status
        .success()
    );
    let recent = (now - 1_000).to_string();
    assert!(
        !run(&[
            "fence",
            "manual-verify",
            "--state",
            &p("fence.json"),
            "--binding",
            &p("binding.json"),
            "--proof",
            &p("proof.json"),
            "--last-contact-ms",
            &recent
        ])
        .status
        .success()
    );
}
