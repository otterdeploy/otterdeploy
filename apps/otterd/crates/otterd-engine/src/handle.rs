//! A shareable journal handle for async code. Appends run on the blocking pool
//! (they fsync) and complete before the caller continues, so ordering with the
//! side effect that follows is preserved.

use otterd_journal::{Journal, JournalError, NodeState};
use otterd_proto::U53;
use otterd_proto::journal::Record;
use std::sync::{Arc, Mutex, MutexGuard};

#[derive(Debug, Clone)]
pub struct JournalHandle {
    inner: Arc<Mutex<Journal>>,
}

#[derive(Debug, thiserror::Error)]
pub enum HandleError {
    #[error(transparent)]
    Journal(#[from] JournalError),
    #[error("journal lock poisoned: a previous append panicked; refusing further writes")]
    Poisoned,
    #[error("journal task failed: {0}")]
    Join(String),
}

impl JournalHandle {
    #[must_use]
    pub fn new(journal: Journal) -> Self {
        Self {
            inner: Arc::new(Mutex::new(journal)),
        }
    }

    fn lock(&self) -> Result<MutexGuard<'_, Journal>, HandleError> {
        self.inner.lock().map_err(|_| HandleError::Poisoned)
    }

    /// Durably append one record (validated against current state).
    pub async fn append(&self, record: Record) -> Result<U53, HandleError> {
        let inner = Arc::clone(&self.inner);
        tokio::task::spawn_blocking(move || {
            let mut journal = inner.lock().map_err(|_| HandleError::Poisoned)?;
            journal.append(record).map_err(HandleError::from)
        })
        .await
        .map_err(|e| HandleError::Join(e.to_string()))?
    }

    /// Clone of the folded state.
    pub fn snapshot(&self) -> Result<NodeState, HandleError> {
        Ok(self.lock()?.state().clone())
    }

    /// Read the state under the lock without cloning it.
    pub fn read<R>(&self, f: impl FnOnce(&NodeState) -> R) -> Result<R, HandleError> {
        Ok(f(self.lock()?.state()))
    }
}
