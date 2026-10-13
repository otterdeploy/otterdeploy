//! A/B binary updates for otterd.
//!
//! ```text
//! <root>/                  /usr/lib/otterd by default
//!   a/otterd  b/otterd     the two slots
//!   current -> a           the slot systemd starts (an atomic symlink)
//!   otterd-guard           never replaced by an update
//!   state.json             slots, the active slot, a pending update
//! ```
//!
//! [`Layout::stage`] verifies a signed [`ReleaseManifest`] against the pinned
//! release keys, checks the binary by architecture, size and SHA-256, writes
//! it into the inactive slot, records the update as pending with a boot budget,
//! and points `current` at it. The independent guard (`otterd-guard`, run by
//! systemd before every start) spends one boot of the budget per start; when
//! the budget is gone the new binary never became healthy, and the guard points
//! `current` back at the previous slot, but only if that release may be rolled
//! back to and reads the same journal format. The new binary commits the
//! update itself once it is healthy ([`Layout::commit`]).

pub mod keys;
mod layout;

pub use layout::{GuardAction, Layout, Pending, Slot, SlotInfo, UpdateState};

use std::path::PathBuf;

/// Boots a staged release gets to become healthy before it is rolled back.
pub const BOOT_BUDGET: u32 = 3;

#[derive(Debug, thiserror::Error)]
pub enum UpdateError {
    #[error("{path}: {source}")]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("{0}")]
    Refused(String),
    #[error(transparent)]
    Envelope(#[from] otterd_proto::envelope::EnvelopeError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

impl UpdateError {
    pub(crate) fn io(path: impl Into<PathBuf>) -> impl FnOnce(std::io::Error) -> Self {
        let path = path.into();
        move |source| Self::Io { path, source }
    }
}

pub(crate) fn refused<T>(msg: impl Into<String>) -> Result<T, UpdateError> {
    Err(UpdateError::Refused(msg.into()))
}
