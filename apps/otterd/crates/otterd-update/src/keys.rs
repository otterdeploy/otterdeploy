//! The pinned release keys (`/etc/otterd/release-keys.json`).

use crate::{UpdateError, refused};
use otterd_proto::U53;
use otterd_proto::envelope::{SignContext, SignedEnvelope};
use otterd_proto::release::{ReleaseKeySet, ReleaseManifest};
use std::io::Write as _;
use std::os::unix::fs::{MetadataExt as _, OpenOptionsExt as _};
use std::path::Path;

/// Read the pinned set; refuses a file other users can write.
pub fn load(path: &Path) -> Result<ReleaseKeySet, UpdateError> {
    let meta = std::fs::metadata(path).map_err(UpdateError::io(path))?;
    if meta.mode() & 0o022 != 0 {
        return refused(format!("{} is writable by other users", path.display()));
    }
    let bytes = std::fs::read(path).map_err(UpdateError::io(path))?;
    Ok(serde_json::from_slice(&bytes)?)
}

/// Write a key set atomically, root-only.
pub fn store(path: &Path, set: &ReleaseKeySet) -> Result<(), UpdateError> {
    let tmp = path.with_extension("tmp");
    let _ = std::fs::remove_file(&tmp);
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&tmp)
        .map_err(UpdateError::io(&tmp))?;
    f.write_all(&serde_json::to_vec_pretty(set)?)
        .and_then(|()| f.sync_all())
        .map_err(UpdateError::io(&tmp))?;
    std::fs::rename(&tmp, path).map_err(UpdateError::io(path))
}

/// Accept a replacement set signed by a key of the current one, with a
/// higher serial.
pub fn rotate(
    current: &ReleaseKeySet,
    replacement: &SignedEnvelope,
    now: U53,
) -> Result<ReleaseKeySet, UpdateError> {
    let next: ReleaseKeySet =
        replacement.verify(&current.valid_at(now), SignContext::ReleaseKeys)?;
    if next.serial <= current.serial {
        return refused(format!(
            "release key set serial {} does not follow {}",
            next.serial, current.serial
        ));
    }
    if next.keys.is_empty() {
        return refused("a release key set needs at least one key");
    }
    Ok(next)
}

/// Verify a release against the keys valid at `now`.
pub fn verify_release(
    keys: &ReleaseKeySet,
    release: &SignedEnvelope,
    now: U53,
) -> Result<ReleaseManifest, UpdateError> {
    Ok(release.verify(&keys.valid_at(now), SignContext::ReleaseManifest)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;
    use otterd_proto::envelope::PublicKey;
    use otterd_proto::release::ReleaseKey;

    fn key(seed: u8, not_after: Option<u64>) -> (SigningKey, ReleaseKey) {
        let k = SigningKey::from_bytes(&[seed; 32]);
        let r = ReleaseKey {
            key: PublicKey::from_verifying_key(&k.verifying_key()),
            not_before_unix_ms: None,
            not_after_unix_ms: not_after.map(U53::from_const),
        };
        (k, r)
    }

    #[test]
    fn rotation_needs_a_current_key_and_a_higher_serial() {
        let (k1, r1) = key(1, Some(1_000));
        let (k2, r2) = key(2, None);
        let current = ReleaseKeySet {
            serial: U53::ONE,
            keys: vec![r1],
        };
        let next = ReleaseKeySet {
            serial: U53::from_const(2),
            keys: vec![r2.clone()],
        };
        let signed = |k: &SigningKey, s: &ReleaseKeySet| {
            SignedEnvelope::sign(k, SignContext::ReleaseKeys, s).unwrap()
        };
        let now = U53::from_const(500);
        assert_eq!(rotate(&current, &signed(&k1, &next), now).unwrap(), next);
        assert!(
            rotate(&current, &signed(&k2, &next), now).is_err(),
            "signed by the incoming key only"
        );
        assert!(
            rotate(&current, &signed(&k1, &next), U53::from_const(1_000)).is_err(),
            "the signer expired"
        );
        let stale = ReleaseKeySet {
            serial: U53::ONE,
            keys: vec![r2],
        };
        assert!(
            rotate(&current, &signed(&k1, &stale), now).is_err(),
            "serial must increase"
        );

        let release = SignedEnvelope::sign(&k2, SignContext::ReleaseManifest, &serde_json::json!({
            "version": "1.0.0", "artifacts": [], "protocol": {"min": 1, "max": 1}, "journalFormat": 1,
            "minRollbackVersion": "1.0.0", "issuedAtUnixMs": 1})).unwrap();
        assert!(
            verify_release(&current, &release, now).is_err(),
            "not a pinned key"
        );
        assert!(verify_release(&next, &release, now).is_ok());
    }
}
