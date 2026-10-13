//! The recovery CLI's logic. It works with the daemon, the control plane, the
//! database and the network down:
//!
//! * [`keys`]: offline signing keys (recovery root, enrollment), root-only files.
//! * [`journal`]: read a node journal without its lock and list what still
//!   blocks (unresolved submissions, unreleased grants, open holds).
//! * [`authority`]: sign an authority revocation with the recovery key and
//!   apply it, through the daemon's local socket or, with the daemon stopped
//!   (a rescue system), straight into the journal.
//! * Anchor and fence commands are thin wrappers over `otterd-anchor` and
//!   `otterd-fence`, in the binary.

pub mod authority;
pub mod journal;
pub mod keys;

use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum RecoverError {
    #[error("{path}: {source}")]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("{0}")]
    Refused(String),
    #[error(transparent)]
    Journal(#[from] otterd_journal::JournalError),
    #[error(transparent)]
    Envelope(#[from] otterd_proto::envelope::EnvelopeError),
    #[error(transparent)]
    Anchor(#[from] otterd_anchor::AnchorError),
    #[error(transparent)]
    S3(#[from] otterd_anchor::s3::S3Error),
    #[error(transparent)]
    Fence(#[from] otterd_fence::FenceError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

impl RecoverError {
    pub(crate) fn io(path: impl Into<PathBuf>) -> impl FnOnce(std::io::Error) -> Self {
        let path = path.into();
        move |source| Self::Io { path, source }
    }
}

/// Wall-clock milliseconds.
#[must_use]
pub fn now_ms() -> otterd_proto::U53 {
    otterd_journal::now_unix_ms()
}
