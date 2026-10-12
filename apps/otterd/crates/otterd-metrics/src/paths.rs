//! Where the collector reads the host from.

use std::path::{Path, PathBuf};

/// Roots of the kernel's pseudo filesystems. Production uses `/proc` and
/// `/sys`; tests point them at fixture trees.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostPaths {
    proc: PathBuf,
    sys: PathBuf,
}

impl Default for HostPaths {
    fn default() -> Self {
        Self::new("/proc", "/sys")
    }
}

impl HostPaths {
    pub fn new(proc: impl Into<PathBuf>, sys: impl Into<PathBuf>) -> Self {
        Self {
            proc: proc.into(),
            sys: sys.into(),
        }
    }

    pub fn proc(&self, rel: impl AsRef<Path>) -> PathBuf {
        self.proc.join(rel)
    }

    pub fn sys(&self, rel: impl AsRef<Path>) -> PathBuf {
        self.sys.join(rel)
    }
}
