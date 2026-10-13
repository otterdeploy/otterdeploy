//! Signed releases (`otterd/release-manifest/v1`) and the release keys that
//! sign them (`otterd/release-keys/v1`).
//!
//! The installer pins the release keys on the node (root-only
//! `/etc/otterd/release-keys.json`). A new key set is accepted only when a key
//! of the current set signs it, so release keys rotate without reinstalling.
//! A release names its binaries per architecture by name, size and SHA-256
//! (`otterd` itself and its companions: `otterd-guard`, `otterd-recover`,
//! `otterd-net`, `otterd-dns`), the protocol range and journal format it
//! speaks, and the oldest version it may be rolled back to. One manifest
//! signs every binary an installer may run; a `(name, arch)` pair appears at
//! most once.

use crate::envelope::PublicKey;
use crate::ids::Sha256Hex;
use crate::num::{U53, UnixMs};
use crate::version::VersionRange;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseArtifact {
    /// The binary's name; absent means `otterd`. Lowercase letters, digits
    /// and `-`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// `x86_64` or `aarch64` (Rust's `std::env::consts::ARCH`).
    pub arch: String,
    pub sha256: Sha256Hex,
    pub size: U53,
}

/// The daemon's own binary, the one `node.upgrade` stages in the A/B slots.
pub const OTTERD: &str = "otterd";

impl ReleaseArtifact {
    /// The binary's name, `otterd` when the manifest does not name it.
    #[must_use]
    pub fn name(&self) -> &str {
        self.name.as_deref().unwrap_or(OTTERD)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    deny_unknown_fields,
    try_from = "UncheckedReleaseManifest"
)]
pub struct ReleaseManifest {
    /// Semantic version of this otterd release.
    pub version: String,
    pub artifacts: Vec<ReleaseArtifact>,
    pub protocol: VersionRange,
    pub journal_format: u16,
    /// The oldest release this one may be rolled back to.
    pub min_rollback_version: String,
    pub issued_at_unix_ms: UnixMs,
}

/// The wire form before the artifact list is checked.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UncheckedReleaseManifest {
    version: String,
    artifacts: Vec<ReleaseArtifact>,
    protocol: VersionRange,
    journal_format: u16,
    min_rollback_version: String,
    issued_at_unix_ms: UnixMs,
}

impl TryFrom<UncheckedReleaseManifest> for ReleaseManifest {
    type Error = String;

    fn try_from(m: UncheckedReleaseManifest) -> Result<Self, String> {
        let mut seen = std::collections::BTreeSet::new();
        for a in &m.artifacts {
            let name = a.name();
            if name.is_empty()
                || !name
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            {
                return Err(format!("artifact name {name:?} is not a binary name"));
            }
            if !seen.insert((name, a.arch.as_str())) {
                return Err(format!("artifact {name} for {} is listed twice", a.arch));
            }
        }
        Ok(Self {
            version: m.version,
            artifacts: m.artifacts,
            protocol: m.protocol,
            journal_format: m.journal_format,
            min_rollback_version: m.min_rollback_version,
            issued_at_unix_ms: m.issued_at_unix_ms,
        })
    }
}

impl ReleaseManifest {
    /// The daemon binary for `arch`: what `node.upgrade` stages.
    #[must_use]
    pub fn artifact(&self, arch: &str) -> Option<&ReleaseArtifact> {
        self.named(OTTERD, arch)
    }

    /// The binary called `name` for `arch`.
    #[must_use]
    pub fn named(&self, name: &str, arch: &str) -> Option<&ReleaseArtifact> {
        self.artifacts
            .iter()
            .find(|a| a.name() == name && a.arch == arch)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseKey {
    pub key: PublicKey,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub not_before_unix_ms: Option<UnixMs>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub not_after_unix_ms: Option<UnixMs>,
}

impl ReleaseKey {
    #[must_use]
    pub fn valid_at(&self, now: UnixMs) -> bool {
        self.not_before_unix_ms.is_none_or(|t| now >= t)
            && self.not_after_unix_ms.is_none_or(|t| now < t)
    }
}

/// The pinned key set. A replacement set is signed by a key of the current one.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseKeySet {
    /// Increases with every replacement.
    pub serial: U53,
    pub keys: Vec<ReleaseKey>,
}

impl ReleaseKeySet {
    /// Keys that verify signatures at `now`.
    #[must_use]
    pub fn valid_at(&self, now: UnixMs) -> Vec<PublicKey> {
        self.keys
            .iter()
            .filter(|k| k.valid_at(now))
            .map(|k| k.key.clone())
            .collect()
    }
}

/// Compare dotted numeric versions (`1.4.0` < `1.10.0`); pre-release and build
/// suffixes after `-` or `+` are ignored. `None` when either is not numeric.
#[must_use]
pub fn compare_versions(a: &str, b: &str) -> Option<std::cmp::Ordering> {
    fn parts(v: &str) -> Option<Vec<u64>> {
        v.split(['-', '+'])
            .next()?
            .split('.')
            .map(|p| p.parse().ok())
            .collect()
    }
    Some(parts(a)?.cmp(&parts(b)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Ordering;

    #[test]
    fn versions_compare_numerically() {
        assert_eq!(compare_versions("1.4.0", "1.10.0"), Some(Ordering::Less));
        assert_eq!(
            compare_versions("2.0.0-rc.1", "2.0.0"),
            Some(Ordering::Equal)
        );
        assert_eq!(compare_versions("1.x", "1.0"), None);
    }

    fn manifest(artifacts: &serde_json::Value) -> Result<ReleaseManifest, serde_json::Error> {
        serde_json::from_value(serde_json::json!({
            "version": "1.4.0", "artifacts": artifacts,
            "protocol": {"min": 1, "max": 1}, "journalFormat": 1,
            "minRollbackVersion": "1.3.0", "issuedAtUnixMs": 1
        }))
    }

    #[test]
    fn one_manifest_signs_every_binary_once_per_arch() {
        let sha = "a".repeat(64);
        let m = manifest(&serde_json::json!([
            {"arch": "x86_64", "sha256": sha, "size": 1},
            {"name": "otterd-dns", "arch": "x86_64", "sha256": sha, "size": 2},
            {"name": "otterd", "arch": "aarch64", "sha256": sha, "size": 3}
        ]))
        .unwrap();
        // node.upgrade selects the daemon; an unnamed artifact is `otterd`.
        assert_eq!(m.artifact("x86_64").map(|a| a.size.get()), Some(1));
        assert_eq!(m.artifact("aarch64").map(|a| a.size.get()), Some(3));
        assert_eq!(
            m.named("otterd-dns", "x86_64").map(|a| a.size.get()),
            Some(2)
        );
        assert!(m.named("otterd-dns", "aarch64").is_none());
        // Unnamed and explicit `otterd` for one arch are the same binary.
        assert!(
            manifest(&serde_json::json!([
                {"arch": "x86_64", "sha256": sha, "size": 1},
                {"name": "otterd", "arch": "x86_64", "sha256": sha, "size": 1}
            ]))
            .is_err()
        );
        assert!(
            manifest(&serde_json::json!([
                {"name": "otterd-net", "arch": "x86_64", "sha256": sha, "size": 1},
                {"name": "otterd-net", "arch": "x86_64", "sha256": sha, "size": 2}
            ]))
            .is_err()
        );
        assert!(
            manifest(&serde_json::json!([
                {"name": "../otterd", "arch": "x86_64", "sha256": sha, "size": 1}
            ]))
            .is_err()
        );
    }

    #[test]
    fn keys_are_valid_only_inside_their_window() {
        let k = ReleaseKey {
            key: PublicKey::from_bytes([1; 32]),
            not_before_unix_ms: Some(U53::from_const(10)),
            not_after_unix_ms: Some(U53::from_const(20)),
        };
        assert!(!k.valid_at(U53::from_const(9)));
        assert!(k.valid_at(U53::from_const(10)));
        assert!(!k.valid_at(U53::from_const(20)));
    }
}
