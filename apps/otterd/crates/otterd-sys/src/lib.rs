//! Linux host primitives otterd needs and that std does not provide.
//!
//! * [`staging`]: retained mount identity across Engine submission. A source is
//!   opened once without following symlinks or crossing mounts, that exact
//!   object is kept, and it is exposed at a root-only staging path that is the
//!   only thing Docker ever sees.
//! * [`host`]: kernel boot id, the boot clock, physical host identity for the
//!   signed boot manifest, mount-namespace checks, and the container cgroup
//!   observation a positive stop certificate relies on.
//! * [`notify`]: `sd_notify(3)` for `Type=notify` units and the watchdog.
//!
//! Everything here is safe Rust (`rustix` wraps the system calls). On other
//! platforms the Linux-only functions return [`SysError::Unsupported`].

pub mod host;
pub mod notify;
pub mod staging;

#[derive(Debug, thiserror::Error)]
pub enum SysError {
    #[error("{op} {path}: {source}")]
    Io {
        op: &'static str,
        path: String,
        source: std::io::Error,
    },
    #[error("{0}")]
    Refused(String),
    #[error("not supported on this platform")]
    Unsupported,
}

impl SysError {
    pub(crate) fn io(
        op: &'static str,
        path: impl AsRef<std::path::Path>,
        source: impl Into<std::io::Error>,
    ) -> Self {
        Self::Io {
            op,
            path: path.as_ref().display().to_string(),
            source: source.into(),
        }
    }
}
