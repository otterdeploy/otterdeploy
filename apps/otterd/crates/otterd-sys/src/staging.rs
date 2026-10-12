//! Retained mount identity across Engine submission.
//!
//! A pathname check validates one lookup; Docker's delayed lookup of the same
//! string can resolve somewhere else (a tenant can rename the directory or
//! replace it with a symlink to `/etc` between create and start). So otterd
//! never hands Docker the tenant path. It:
//!
//! 1. opens the source once with `openat2(O_PATH | O_DIRECTORY,
//!    RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_XDEV)`: any
//!    symlink in the path or a mount crossing is refused (the conservative
//!    first adapter);
//! 2. records the object's `(st_dev, st_ino, mnt_id)` from that same descriptor;
//! 3. clones exactly that object as a detached mount (`open_tree(OPEN_TREE_CLONE)`)
//!    and attaches it with `move_mount` at a unique path under a root-only,
//!    private staging root;
//! 4. re-reads the identity at the staging path and refuses a mismatch.
//!
//! Docker receives only the staging path. The staging root lives on tmpfs, so
//! a stage does not survive a reboot; the journal keeps the obligation and an
//! absent stage is Unknown, never re-created from the tenant path.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// `(st_dev, st_ino, mnt_id)` of an opened object.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectIdentity {
    pub dev: u64,
    pub ino: u64,
    pub mnt_id: u64,
}

impl ObjectIdentity {
    /// Same filesystem object (the mount ids of a source and its stage differ
    /// by design).
    #[must_use]
    pub fn same_object(&self, other: &Self) -> bool {
        self.dev == other.dev && self.ino == other.ino
    }
}

/// What the stage at a path looks like right now.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "stage", rename_all = "kebab-case")]
pub enum StageObservation {
    /// No mount at the staging path (for example after a reboot).
    Missing,
    /// A mount exposing the expected object.
    Present { identity: ObjectIdentity },
    /// Something else is there: never treated as the held object.
    Mismatch { identity: ObjectIdentity },
}

/// Unique staging path for a hold. Hold ids are minted once, so a staging path
/// is never reused while any request could still resolve it.
#[must_use]
pub fn staging_path_for(staging_root: &Path, hold_id: &str) -> PathBuf {
    staging_root.join(hold_id)
}

#[cfg(target_os = "linux")]
mod imp {
    use super::{ObjectIdentity, StageObservation};
    use crate::SysError;
    use rustix::fd::{AsFd, OwnedFd};
    use rustix::fs::{AtFlags, CWD, Mode, OFlags, ResolveFlags, StatxFlags};
    use rustix::io::Errno;
    use rustix::mount::{
        MountPropagationFlags, MoveMountFlags, OpenTreeFlags, UnmountFlags, mount_bind,
        mount_change, move_mount, open_tree, unmount,
    };
    use std::os::unix::fs::{DirBuilderExt as _, MetadataExt as _, PermissionsExt as _};
    use std::path::{Path, PathBuf};

    fn identity_of<Fd: AsFd>(fd: Fd, path: &Path) -> Result<ObjectIdentity, SysError> {
        let st = rustix::fs::statx(
            fd,
            "",
            AtFlags::EMPTY_PATH,
            StatxFlags::INO | StatxFlags::MNT_ID,
        )
        .map_err(|e| SysError::io("statx", path, e))?;
        if st.stx_mask & StatxFlags::MNT_ID.bits() == 0 {
            return Err(SysError::Refused(format!(
                "{}: the kernel does not report mount ids (needs Linux 5.8+)",
                path.display()
            )));
        }
        Ok(ObjectIdentity {
            dev: rustix::fs::makedev(st.stx_dev_major, st.stx_dev_minor),
            ino: st.stx_ino,
            mnt_id: st.stx_mnt_id,
        })
    }

    fn open_path_nofollow(path: &Path) -> Result<OwnedFd, SysError> {
        rustix::fs::open(
            path,
            OFlags::PATH | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|e| SysError::io("open", path, e))
    }

    /// A source opened once and held for the lifetime of its hold.
    #[derive(Debug)]
    pub struct RetainedSource {
        fd: OwnedFd,
        path: PathBuf,
        identity: ObjectIdentity,
    }

    impl RetainedSource {
        /// Open absolute `path` without following any symlink or crossing a mount.
        pub fn open(path: &Path) -> Result<Self, SysError> {
            if !path.is_absolute() {
                return Err(SysError::Refused(format!(
                    "{} is not absolute",
                    path.display()
                )));
            }
            let fd = rustix::fs::openat2(
                CWD,
                path,
                OFlags::PATH | OFlags::DIRECTORY | OFlags::CLOEXEC,
                Mode::empty(),
                ResolveFlags::NO_SYMLINKS | ResolveFlags::NO_MAGICLINKS | ResolveFlags::NO_XDEV,
            )
            .map_err(|e| match e {
                Errno::LOOP => {
                    SysError::Refused(format!("{}: a path component is a symlink", path.display()))
                }
                Errno::XDEV => {
                    SysError::Refused(format!("{}: the path crosses a mount", path.display()))
                }
                Errno::NOTDIR => SysError::Refused(format!("{}: not a directory", path.display())),
                other => SysError::io("openat2", path, other),
            })?;
            let identity = identity_of(&fd, path)?;
            Ok(Self {
                fd,
                path: path.to_owned(),
                identity,
            })
        }

        #[must_use]
        pub fn identity(&self) -> ObjectIdentity {
            self.identity
        }

        #[must_use]
        pub fn path(&self) -> &Path {
            &self.path
        }

        /// Clone exactly this object as a mount and attach it at `staging_path`,
        /// directly under the private root-only `staging_root`.
        pub fn stage(
            &self,
            staging_root: &Path,
            staging_path: &Path,
        ) -> Result<ObjectIdentity, SysError> {
            ensure_private_root(staging_root)?;
            if staging_path.parent() != Some(staging_root) {
                return Err(SysError::Refused(format!(
                    "{} is not directly under {}",
                    staging_path.display(),
                    staging_root.display()
                )));
            }
            match std::fs::DirBuilder::new().mode(0o700).create(staging_path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    return Err(SysError::Refused(format!(
                        "staging path {} already exists",
                        staging_path.display()
                    )));
                }
                Err(e) => return Err(SysError::io("mkdir", staging_path, e)),
            }
            let attached = open_tree(
                &self.fd,
                "",
                OpenTreeFlags::OPEN_TREE_CLONE
                    | OpenTreeFlags::OPEN_TREE_CLOEXEC
                    | OpenTreeFlags::AT_EMPTY_PATH,
            )
            .map_err(|e| SysError::io("open_tree", &self.path, e))
            .and_then(|tree| {
                move_mount(
                    &tree,
                    "",
                    CWD,
                    staging_path,
                    MoveMountFlags::MOVE_MOUNT_F_EMPTY_PATH,
                )
                .map_err(|e| SysError::io("move_mount", staging_path, e))
            });
            if let Err(e) = attached {
                remove_dir_best_effort(staging_path);
                return Err(e);
            }
            match observe_stage(staging_path, &self.identity)? {
                StageObservation::Present { identity } => Ok(identity),
                other => {
                    if let Err(e) = unstage(staging_path) {
                        tracing::error!(path = %staging_path.display(), error = %e, "could not remove a mismatched stage");
                    }
                    Err(SysError::Refused(format!(
                        "stage {} does not expose the held object: {other:?}",
                        staging_path.display()
                    )))
                }
            }
        }
    }

    fn remove_dir_best_effort(path: &Path) {
        if let Err(e) = std::fs::remove_dir(path) {
            tracing::warn!(path = %path.display(), error = %e, "could not remove a staging directory");
        }
    }

    /// Inspect a staging path without following symlinks.
    pub fn observe_stage(
        staging_path: &Path,
        expected: &ObjectIdentity,
    ) -> Result<StageObservation, SysError> {
        let Some(parent) = staging_path.parent() else {
            return Ok(StageObservation::Missing);
        };
        if !parent.exists() {
            // The staging root itself is gone (fresh tmpfs after a reboot).
            return Ok(StageObservation::Missing);
        }
        let parent_mnt = identity_of(open_path_nofollow(parent)?, parent)?.mnt_id;
        let fd = match rustix::fs::open(
            staging_path,
            OFlags::PATH | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        ) {
            Ok(fd) => fd,
            Err(Errno::NOENT) => return Ok(StageObservation::Missing),
            Err(e) => return Err(SysError::io("open", staging_path, e)),
        };
        let identity = identity_of(&fd, staging_path)?;
        if identity.mnt_id == parent_mnt {
            // A plain directory, not a mount: the stage is gone.
            return Ok(StageObservation::Missing);
        }
        Ok(if identity.same_object(expected) {
            StageObservation::Present { identity }
        } else {
            StageObservation::Mismatch { identity }
        })
    }

    /// Detach the stage and remove its directory. Callers must hold the release
    /// barrier: no request may still resolve this path.
    pub fn unstage(staging_path: &Path) -> Result<(), SysError> {
        match unmount(staging_path, UnmountFlags::DETACH | UnmountFlags::NOFOLLOW) {
            Ok(()) | Err(Errno::INVAL | Errno::NOENT) => {}
            Err(e) => return Err(SysError::io("umount2", staging_path, e)),
        }
        match std::fs::remove_dir(staging_path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(SysError::io("rmdir", staging_path, e)),
        }
    }

    /// The staging root: a root-owned 0700 directory that is its own private
    /// mount, so stages never propagate into other mount namespaces.
    pub fn ensure_private_root(root: &Path) -> Result<(), SysError> {
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(root)
            .map_err(|e| SysError::io("mkdir", root, e))?;
        let meta = std::fs::symlink_metadata(root).map_err(|e| SysError::io("stat", root, e))?;
        if !meta.is_dir() || meta.uid() != 0 {
            return Err(SysError::Refused(format!(
                "{} must be a root-owned directory",
                root.display()
            )));
        }
        if meta.permissions().mode() & 0o077 != 0 {
            std::fs::set_permissions(root, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| SysError::io("chmod", root, e))?;
        }
        let parent = root.parent().unwrap_or(root);
        let own = identity_of(open_path_nofollow(root)?, root)?.mnt_id;
        let above = identity_of(open_path_nofollow(parent)?, parent)?.mnt_id;
        if own == above {
            mount_bind(root, root).map_err(|e| SysError::io("bind", root, e))?;
        }
        mount_change(root, MountPropagationFlags::PRIVATE)
            .map_err(|e| SysError::io("make-private", root, e))
    }
}

#[cfg(target_os = "linux")]
pub use imp::{RetainedSource, ensure_private_root, observe_stage, unstage};

#[cfg(not(target_os = "linux"))]
mod imp_other {
    use super::{ObjectIdentity, StageObservation};
    use crate::SysError;
    use std::path::Path;

    #[derive(Debug)]
    pub struct RetainedSource(());

    impl RetainedSource {
        pub fn open(_path: &Path) -> Result<Self, SysError> {
            Err(SysError::Unsupported)
        }

        pub fn identity(&self) -> ObjectIdentity {
            ObjectIdentity {
                dev: 0,
                ino: 0,
                mnt_id: 0,
            }
        }

        pub fn path(&self) -> &Path {
            Path::new("")
        }

        pub fn stage(&self, _root: &Path, _path: &Path) -> Result<ObjectIdentity, SysError> {
            Err(SysError::Unsupported)
        }
    }

    pub fn observe_stage(_p: &Path, _e: &ObjectIdentity) -> Result<StageObservation, SysError> {
        Err(SysError::Unsupported)
    }

    pub fn unstage(_p: &Path) -> Result<(), SysError> {
        Err(SysError::Unsupported)
    }

    pub fn ensure_private_root(_p: &Path) -> Result<(), SysError> {
        Err(SysError::Unsupported)
    }
}

#[cfg(not(target_os = "linux"))]
pub use imp_other::{RetainedSource, ensure_private_root, observe_stage, unstage};
