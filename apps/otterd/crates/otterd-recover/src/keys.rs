//! Offline signing keys: a root-only file holding the base64 Ed25519 seed.

use crate::RecoverError;
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;
use ed25519_dalek::SigningKey;
use otterd_proto::envelope::PublicKey;
use std::io::Write as _;
use std::os::unix::fs::{MetadataExt as _, OpenOptionsExt as _};
use std::path::Path;

/// Create a new key at `path` (0600, never overwritten); returns its public half.
pub fn generate(path: &Path) -> Result<PublicKey, RecoverError> {
    let key = otterd_proto::envelope::generate_signing_key()
        .map_err(|e| RecoverError::Refused(format!("random source: {e}")))?;
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(RecoverError::io(path))?;
    f.write_all(B64.encode(key.to_bytes()).as_bytes())
        .and_then(|()| f.sync_all())
        .map_err(RecoverError::io(path))?;
    Ok(PublicKey::from_verifying_key(&key.verifying_key()))
}

/// Read a key file; refuses one that other users can read.
pub fn read(path: &Path) -> Result<SigningKey, RecoverError> {
    let meta = std::fs::metadata(path).map_err(RecoverError::io(path))?;
    if meta.mode() & 0o077 != 0 {
        return Err(RecoverError::Refused(format!(
            "{} is readable by other users; keys must be 0600",
            path.display()
        )));
    }
    let text = std::fs::read_to_string(path).map_err(RecoverError::io(path))?;
    let bytes = B64
        .decode(text.trim().as_bytes())
        .map_err(|_| RecoverError::Refused(format!("{} is not a base64 key", path.display())))?;
    let seed: [u8; 32] = bytes
        .try_into()
        .map_err(|_| RecoverError::Refused(format!("{} must hold 32 bytes", path.display())))?;
    Ok(SigningKey::from_bytes(&seed))
}

/// A public key given as base64.
pub fn public(text: &str) -> Result<PublicKey, RecoverError> {
    Ok(serde_json::from_value(serde_json::Value::String(
        text.trim().to_owned(),
    ))?)
}
