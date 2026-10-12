//! The stored WireGuard key works with the real WireGuard tools and kernel.
//! Ignored by default; run as root on Linux with `wireguard-tools`:
//!
//! ```sh
//! cargo test -p otterd-identity --test wireguard -- --ignored
//! ```
#![allow(clippy::unwrap_used, clippy::panic)]

use otterd_identity::KeyStore;
use std::io::Write as _;
use std::process::{Command, Stdio};

fn wg(args: &[&str], stdin: Option<&str>) -> String {
    let mut child = Command::new("wg")
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    if let Some(input) = stdin {
        child
            .stdin
            .take()
            .unwrap()
            .write_all(input.as_bytes())
            .unwrap();
    }
    let out = child.wait_with_output().unwrap();
    assert!(out.status.success(), "wg {args:?} failed");
    String::from_utf8(out.stdout).unwrap().trim().to_owned()
}

fn ip(args: &[&str]) -> bool {
    Command::new("ip").args(args).status().unwrap().success()
}

#[test]
#[ignore = "needs root, wireguard-tools and the wireguard kernel module"]
fn wireguard_accepts_the_stored_key_and_derives_the_same_public_key() {
    let dir = tempfile::tempdir().unwrap();
    let store = KeyStore::new(dir.path().join("keys"));
    let keys = store.create().unwrap();
    let ours = String::from(keys.public().wireguard);

    // wg's own derivation from the private key we stored.
    assert_eq!(wg(&["pubkey"], Some(&keys.wireguard_private())), ours);

    // The kernel accepts the key file as written, and reports the same public key.
    let key_file = store.dir().join("epoch-1").join("wireguard.key");
    let iface = "odtest-wg0";
    let _ = ip(&["link", "del", iface]);
    assert!(ip(&["link", "add", iface, "type", "wireguard"]));
    let set = Command::new("wg")
        .args(["set", iface, "private-key", key_file.to_str().unwrap()])
        .status()
        .unwrap();
    let shown = wg(&["show", iface, "public-key"], None);
    assert!(ip(&["link", "del", iface]));
    assert!(set.success());
    assert_eq!(shown, ours);

    // After a rotation the new epoch's key differs and is equally valid.
    let next = store.prepare_next().unwrap();
    let next_pub = String::from(next.public().wireguard);
    assert_ne!(next_pub, ours);
    assert_eq!(wg(&["pubkey"], Some(&next.wireguard_private())), next_pub);
}
