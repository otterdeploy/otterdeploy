//! The A/B slots, the `current` link and the update state.

use crate::{BOOT_BUDGET, UpdateError, refused};
use otterd_proto::ids::Sha256Hex;
use otterd_proto::release::{ReleaseManifest, compare_versions};
use otterd_proto::version::VersionRange;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::Write as _;
use std::os::unix::fs::{OpenOptionsExt as _, PermissionsExt as _};
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Slot {
    A,
    B,
}

impl Slot {
    #[must_use]
    pub fn other(self) -> Self {
        match self {
            Self::A => Self::B,
            Self::B => Self::A,
        }
    }

    #[must_use]
    pub fn dir(self) -> &'static str {
        match self {
            Self::A => "a",
            Self::B => "b",
        }
    }
}

/// What is installed in a slot.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotInfo {
    pub version: String,
    pub sha256: Sha256Hex,
    pub protocol: VersionRange,
    pub journal_format: u16,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    pub slot: Slot,
    pub previous: Slot,
    pub version: String,
    pub min_rollback_version: String,
    /// Starts left before the guard rolls back.
    pub boots_left: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    pub active: Slot,
    pub slots: BTreeMap<Slot, SlotInfo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending: Option<Pending>,
    /// The last rollback the guard made, for operators.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rolled_back: Option<String>,
}

/// What the guard did at a start.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "action", rename_all = "kebab-case")]
pub enum GuardAction {
    Nothing,
    /// A pending update gets this start; `boots_left` remain after it.
    Trial {
        slot: Slot,
        boots_left: u32,
    },
    /// The pending update never became healthy: back to `to`.
    RolledBack {
        to: Slot,
        version: String,
    },
    /// Out of boots, but the previous release may not be rolled back to.
    Stuck {
        reason: String,
    },
}

#[derive(Debug, Clone)]
pub struct Layout {
    root: PathBuf,
}

fn write_atomic(path: &Path, bytes: &[u8], mode: u32) -> Result<(), UpdateError> {
    let tmp = path.with_extension("tmp");
    let _ = std::fs::remove_file(&tmp);
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(mode)
        .open(&tmp)
        .map_err(UpdateError::io(&tmp))?;
    f.write_all(bytes)
        .and_then(|()| f.sync_all())
        .map_err(UpdateError::io(&tmp))?;
    std::fs::rename(&tmp, path).map_err(UpdateError::io(path))?;
    if let Some(dir) = path.parent() {
        std::fs::File::open(dir)
            .and_then(|d| d.sync_all())
            .map_err(UpdateError::io(dir))?;
    }
    Ok(())
}

impl Layout {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    #[must_use]
    pub fn binary(&self, slot: Slot) -> PathBuf {
        self.root.join(slot.dir()).join("otterd")
    }

    fn state_path(&self) -> PathBuf {
        self.root.join("state.json")
    }

    pub fn state(&self) -> Result<UpdateState, UpdateError> {
        let p = self.state_path();
        let bytes = std::fs::read(&p).map_err(UpdateError::io(&p))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    fn save(&self, s: &UpdateState) -> Result<(), UpdateError> {
        write_atomic(&self.state_path(), &serde_json::to_vec_pretty(s)?, 0o600)
    }

    /// Point `current` at `slot` atomically.
    fn point_current(&self, slot: Slot) -> Result<(), UpdateError> {
        let tmp = self.root.join("current.tmp");
        let _ = std::fs::remove_file(&tmp);
        std::os::unix::fs::symlink(slot.dir(), &tmp).map_err(UpdateError::io(&tmp))?;
        let current = self.root.join("current");
        std::fs::rename(&tmp, &current).map_err(UpdateError::io(&current))?;
        std::fs::File::open(&self.root)
            .and_then(|d| d.sync_all())
            .map_err(UpdateError::io(&self.root))
    }

    fn write_binary(&self, slot: Slot, bytes: &[u8]) -> Result<(), UpdateError> {
        let dir = self.root.join(slot.dir());
        std::fs::create_dir_all(&dir).map_err(UpdateError::io(&dir))?;
        let path = self.binary(slot);
        write_atomic(&path, bytes, 0o755)?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .map_err(UpdateError::io(&path))
    }

    /// First installation: slot `a` holds `binary`, `current` points at it.
    pub fn install(&self, binary: &[u8], info: SlotInfo) -> Result<(), UpdateError> {
        if self.state_path().exists() {
            return refused("already installed; use an update");
        }
        std::fs::create_dir_all(&self.root).map_err(UpdateError::io(&self.root))?;
        self.write_binary(Slot::A, binary)?;
        self.point_current(Slot::A)?;
        self.save(&UpdateState {
            active: Slot::A,
            slots: BTreeMap::from([(Slot::A, info)]),
            pending: None,
            rolled_back: None,
        })
    }

    /// Stage a verified release into the inactive slot and point `current`
    /// at it. `journal_format` is the format of this node's journal.
    pub fn stage(
        &self,
        release: &ReleaseManifest,
        arch: &str,
        binary: &[u8],
        journal_format: u16,
    ) -> Result<Slot, UpdateError> {
        let mut s = self.state()?;
        if let Some(p) = &s.pending {
            return refused(format!("update to {} is still pending", p.version));
        }
        let artifact = release.artifact(arch).ok_or_else(|| {
            UpdateError::Refused(format!("release {} has no {arch} binary", release.version))
        })?;
        if u64::try_from(binary.len()).ok() != Some(artifact.size.get())
            || Sha256Hex::digest(binary) != artifact.sha256
        {
            return refused("the binary does not match the signed release");
        }
        if release.journal_format < journal_format {
            return refused(format!(
                "release {} reads journal format {}, this node's journal is format {journal_format}",
                release.version, release.journal_format
            ));
        }
        let slot = s.active.other();
        self.write_binary(slot, binary)?;
        s.slots.insert(
            slot,
            SlotInfo {
                version: release.version.clone(),
                sha256: artifact.sha256.clone(),
                protocol: release.protocol,
                journal_format: release.journal_format,
            },
        );
        s.pending = Some(Pending {
            slot,
            previous: s.active,
            version: release.version.clone(),
            min_rollback_version: release.min_rollback_version.clone(),
            boots_left: BOOT_BUDGET,
        });
        s.rolled_back = None;
        // State first: a crash before the link flip leaves the old binary
        // current, and the guard then clears the stale pending update.
        self.save(&s)?;
        self.point_current(slot)?;
        Ok(slot)
    }

    /// Run by `otterd-guard` before every start.
    pub fn guard(&self, journal_format: u16) -> Result<GuardAction, UpdateError> {
        let mut s = self.state()?;
        let Some(mut p) = s.pending.clone() else {
            return Ok(GuardAction::Nothing);
        };
        let current = std::fs::read_link(self.root.join("current"))
            .map_err(UpdateError::io(self.root.join("current")))?;
        if current != Path::new(p.slot.dir()) {
            // The link never moved (a crash while staging): nothing to try.
            s.pending = None;
            self.save(&s)?;
            return Ok(GuardAction::Nothing);
        }
        if p.boots_left > 0 {
            p.boots_left -= 1;
            let left = p.boots_left;
            s.pending = Some(p.clone());
            self.save(&s)?;
            return Ok(GuardAction::Trial {
                slot: p.slot,
                boots_left: left,
            });
        }
        let Some(previous) = s.slots.get(&p.previous).cloned() else {
            return Ok(GuardAction::Stuck {
                reason: "the previous slot is empty".into(),
            });
        };
        if compare_versions(&previous.version, &p.min_rollback_version)
            .is_none_or(|o| o == std::cmp::Ordering::Less)
        {
            return Ok(GuardAction::Stuck {
                reason: format!(
                    "{} may not be rolled back below {}; {} is installed",
                    p.version, p.min_rollback_version, previous.version
                ),
            });
        }
        if previous.journal_format != journal_format {
            return Ok(GuardAction::Stuck {
                reason: format!(
                    "{} reads journal format {}, the journal is format {journal_format}",
                    previous.version, previous.journal_format
                ),
            });
        }
        self.point_current(p.previous)?;
        s.pending = None;
        s.rolled_back = Some(format!("{} → {}", p.version, previous.version));
        self.save(&s)?;
        Ok(GuardAction::RolledBack {
            to: p.previous,
            version: previous.version,
        })
    }

    /// Called by the running binary once healthy: if it is the pending
    /// release, the update is committed.
    pub fn commit(&self, running: &Path) -> Result<Option<String>, UpdateError> {
        let mut s = self.state()?;
        let Some(p) = s.pending.clone() else {
            return Ok(None);
        };
        let ours = std::fs::canonicalize(running).map_err(UpdateError::io(running))?;
        let staged = std::fs::canonicalize(self.binary(p.slot))
            .map_err(UpdateError::io(self.binary(p.slot)))?;
        if ours != staged {
            return Ok(None);
        }
        s.active = p.slot;
        s.pending = None;
        self.save(&s)?;
        Ok(Some(p.version))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use otterd_proto::U53;
    use otterd_proto::release::ReleaseArtifact;

    fn info(v: &str) -> SlotInfo {
        SlotInfo {
            version: v.into(),
            sha256: Sha256Hex::digest(b"x"),
            protocol: VersionRange { min: 1, max: 1 },
            journal_format: 1,
        }
    }

    fn release(v: &str, bin: &[u8], min_rollback: &str, journal_format: u16) -> ReleaseManifest {
        ReleaseManifest {
            version: v.into(),
            artifacts: vec![ReleaseArtifact {
                arch: "x86_64".into(),
                sha256: Sha256Hex::digest(bin),
                size: U53::new(u64::try_from(bin.len()).unwrap()).unwrap(),
            }],
            protocol: VersionRange { min: 1, max: 1 },
            journal_format,
            min_rollback_version: min_rollback.into(),
            issued_at_unix_ms: U53::ONE,
        }
    }

    #[test]
    fn stage_trial_rollback_and_commit() {
        let t = tempfile::tempdir().unwrap();
        let l = Layout::new(t.path());
        l.install(b"old", info("1.0.0")).unwrap();
        let r = release("1.1.0", b"new", "1.0.0", 1);
        assert!(
            l.stage(&r, "aarch64", b"new", 1).is_err(),
            "no binary for the arch"
        );
        assert!(l.stage(&r, "x86_64", b"tampered", 1).is_err());
        assert_eq!(l.stage(&r, "x86_64", b"new", 1).unwrap(), Slot::B);
        assert!(
            l.stage(&r, "x86_64", b"new", 1).is_err(),
            "one pending update at a time"
        );
        assert_eq!(
            std::fs::read_link(t.path().join("current")).unwrap(),
            Path::new("b")
        );
        for left in (0..BOOT_BUDGET).rev() {
            assert_eq!(
                l.guard(1).unwrap(),
                GuardAction::Trial {
                    slot: Slot::B,
                    boots_left: left
                }
            );
        }
        assert_eq!(
            l.guard(1).unwrap(),
            GuardAction::RolledBack {
                to: Slot::A,
                version: "1.0.0".into()
            }
        );
        assert_eq!(
            std::fs::read_link(t.path().join("current")).unwrap(),
            Path::new("a")
        );
        assert_eq!(l.guard(1).unwrap(), GuardAction::Nothing);

        // Again, and this time the new binary becomes healthy and commits.
        l.stage(&r, "x86_64", b"new", 1).unwrap();
        assert!(matches!(l.guard(1).unwrap(), GuardAction::Trial { .. }));
        assert_eq!(
            l.commit(&l.binary(Slot::A)).unwrap(),
            None,
            "the old binary cannot commit"
        );
        assert_eq!(l.commit(&l.binary(Slot::B)).unwrap(), Some("1.1.0".into()));
        let s = l.state().unwrap();
        assert_eq!((s.active, s.pending), (Slot::B, None));
    }

    #[test]
    fn never_rolls_back_into_an_incompatible_release() {
        let t = tempfile::tempdir().unwrap();
        let l = Layout::new(t.path());
        l.install(b"old", info("1.0.0")).unwrap();
        l.stage(&release("2.0.0", b"new", "1.5.0", 1), "x86_64", b"new", 1)
            .unwrap();
        for _ in 0..BOOT_BUDGET {
            l.guard(1).unwrap();
        }
        assert!(
            matches!(l.guard(1).unwrap(), GuardAction::Stuck { .. }),
            "below minRollbackVersion"
        );
        assert_eq!(
            std::fs::read_link(t.path().join("current")).unwrap(),
            Path::new("b")
        );

        let t = tempfile::tempdir().unwrap();
        let l = Layout::new(t.path());
        l.install(b"old", info("1.0.0")).unwrap();
        l.stage(&release("1.1.0", b"new", "1.0.0", 2), "x86_64", b"new", 1)
            .unwrap();
        for _ in 0..BOOT_BUDGET {
            l.guard(2).unwrap();
        }
        assert!(
            matches!(l.guard(2).unwrap(), GuardAction::Stuck { .. }),
            "the journal moved on"
        );
        assert!(
            l.stage(&release("1.2.0", b"n2", "1.0.0", 1), "x86_64", b"n2", 2)
                .is_err()
        );
    }

    #[test]
    fn a_crash_before_the_link_flip_clears_the_stale_update() {
        let t = tempfile::tempdir().unwrap();
        let l = Layout::new(t.path());
        l.install(b"old", info("1.0.0")).unwrap();
        l.stage(&release("1.1.0", b"new", "1.0.0", 1), "x86_64", b"new", 1)
            .unwrap();
        l.point_current(Slot::A).unwrap();
        assert_eq!(l.guard(1).unwrap(), GuardAction::Nothing);
        assert!(l.state().unwrap().pending.is_none());
    }
}
