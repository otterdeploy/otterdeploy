//! A node's key material and its lifecycle.
//!
//! Three keys are generated on the node and never leave it: the Ed25519
//! identity key (signs session proofs, stop certificates and reports), an
//! X25519 key for encrypting the node's local caches, and the WireGuard key.
//! They rotate together: each rotation is a new key epoch.
//!
//! * [`NodeKeyset`] holds one epoch's private keys and derives the public
//!   [`NodeKeys`](otterd_proto::identity::NodeKeys) the control plane sees.
//! * [`KeyStore`] keeps the epochs on disk (root-only, written atomically)
//!   and makes rotation crash-safe: the next epoch is prepared and offered
//!   before it becomes current, and the journal decides which epoch is
//!   current after a crash.
//! * [`rotation`] builds and verifies the cross-signed rotation statement,
//!   applies control-plane signing-key transitions, and signs the enrollment
//!   request.

mod keyset;
pub mod rotation;
mod store;

pub use keyset::NodeKeyset;
pub use store::KeyStore;

use otterd_proto::U53;
use otterd_proto::envelope::EnvelopeError;
use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum KeyError {
    #[error("{path}: {source}")]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("{path}: {reason}")]
    Corrupt { path: PathBuf, reason: &'static str },
    #[error("{0} is readable or writable by other users; node keys must be root-only")]
    Exposed(PathBuf),
    #[error("{0} already holds node keys; keys are never replaced in place")]
    Exists(PathBuf),
    #[error("no node keys in {0}")]
    Missing(PathBuf),
    #[error("key epoch {requested} cannot follow current epoch {current}")]
    EpochGap { current: U53, requested: U53 },
    #[error(
        "the journal records key epoch {journal} but the key store holds {store}: recovery required"
    )]
    Disagrees { journal: U53, store: U53 },
    #[error("random source: {0}")]
    Random(String),
    #[error(transparent)]
    Envelope(#[from] EnvelopeError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

impl KeyError {
    fn io(path: impl Into<PathBuf>) -> impl FnOnce(std::io::Error) -> Self {
        let path = path.into();
        move |source| Self::Io { path, source }
    }
}
