//! Signed releases (`otterd/release-manifest/v1`) and the release keys that
//! sign them (`otterd/release-keys/v1`).
//!
//! The installer pins the release keys on the node (root-only
//! `/etc/otterd/release-keys.json`). A new key set is accepted only when a key
//! of the current set signs it, so release keys rotate without reinstalling.
//! A release names one binary per architecture by size and SHA-256, the
//! protocol range and journal format it speaks, and the oldest version it may
//! be rolled back to.

use crate::envelope::PublicKey;
use crate::ids::Sha256Hex;
use crate::num::{U53, UnixMs};
use crate::version::VersionRange;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseArtifact {
    /// `x86_64` or `aarch64` (Rust's `std::env::consts::ARCH`).
    pub arch: String,
    pub sha256: Sha256Hex,
    pub size: U53,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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

impl ReleaseManifest {
    #[must_use]
    pub fn artifact(&self, arch: &str) -> Option<&ReleaseArtifact> {
        self.artifacts.iter().find(|a| a.arch == arch)
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
