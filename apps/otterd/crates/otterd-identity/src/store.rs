//! Key epochs on disk.
//!
//! ```text
//! <dir>/                 0700
//!   current              "<epoch>\n", replaced atomically
//!   epoch-<n>/           0700, written as epoch-<n>.tmp then renamed
//!     identity.key       0600, base64 of 32 bytes
//!     cache.key
//!     wireguard.key
//! ```
//!
//! Rotation is two steps so that a crash never strands the node with keys the
//! control plane has not seen, or the control plane with keys the node lost:
//!
//! 1. [`KeyStore::prepare_next`] writes epoch n+1 beside the current one. After
//!    a crash it returns the same keys again, so the statement offered to the
//!    control plane never changes.
//! 2. Once the control plane accepted the rotation and the journal recorded
//!    it, [`KeyStore::activate`] moves `current`. On start,
//!    [`KeyStore::reconcile`] lets the journal decide: a journalled epoch that
//!    was prepared but not yet activated is activated; any other disagreement
//!    is refused.
//!
//! Every file and directory is checked to be inaccessible to other users
//! before a key is read.

use crate::{KeyError, NodeKeyset};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;
use otterd_proto::U53;
use std::fs::{self, File, OpenOptions};
use std::io::Write as _;
use std::os::unix::fs::{DirBuilderExt as _, MetadataExt as _, OpenOptionsExt as _};
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

const CURRENT: &str = "current";

#[derive(Debug, Clone)]
pub struct KeyStore {
    dir: PathBuf,
}

fn epoch_dir_name(epoch: U53) -> String {
    format!("epoch-{epoch}")
}

fn fsync_dir(dir: &Path) -> Result<(), KeyError> {
    File::open(dir)
        .and_then(|d| d.sync_all())
        .map_err(KeyError::io(dir))
}

fn check_private(path: &Path) -> Result<(), KeyError> {
    let meta = fs::symlink_metadata(path).map_err(KeyError::io(path))?;
    if meta.file_type().is_symlink() {
        return Err(KeyError::Corrupt {
            path: path.into(),
            reason: "is a symlink",
        });
    }
    if meta.mode() & 0o077 != 0 {
        return Err(KeyError::Exposed(path.into()));
    }
    Ok(())
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<(), KeyError> {
    let mut f = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(KeyError::io(path))?;
    f.write_all(bytes)
        .and_then(|()| f.sync_all())
        .map_err(KeyError::io(path))
}

fn read_secret(path: &Path) -> Result<Zeroizing<[u8; 32]>, KeyError> {
    check_private(path)?;
    let text = Zeroizing::new(fs::read_to_string(path).map_err(KeyError::io(path))?);
    let bytes =
        Zeroizing::new(
            B64.decode(text.trim().as_bytes())
                .map_err(|_| KeyError::Corrupt {
                    path: path.into(),
                    reason: "not base64",
                })?,
        );
    let mut out = Zeroizing::new([0u8; 32]);
    if bytes.len() != 32 {
        return Err(KeyError::Corrupt {
            path: path.into(),
            reason: "not 32 bytes",
        });
    }
    out.copy_from_slice(&bytes);
    Ok(out)
}

impl KeyStore {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    #[must_use]
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn epoch_dir(&self, epoch: U53) -> PathBuf {
        self.dir.join(epoch_dir_name(epoch))
    }

    /// The key directory exists and holds any key epoch.
    pub fn has_keys(&self) -> Result<bool, KeyError> {
        Ok(self.current_epoch()?.is_some() || !self.epochs()?.is_empty())
    }

    /// Create the store with key epoch 1. Refuses when any keys exist: a node
    /// identity is never replaced in place.
    pub fn create(&self) -> Result<NodeKeyset, KeyError> {
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&self.dir)
            .map_err(KeyError::io(&self.dir))?;
        check_private(&self.dir)?;
        if self.has_keys()? {
            return Err(KeyError::Exists(self.dir.clone()));
        }
        let keys = NodeKeyset::generate(U53::ONE)?;
        self.write_epoch(&keys)?;
        self.write_current(U53::ONE)?;
        Ok(keys)
    }

    /// The epoch `current` names, if the store has been created.
    pub fn current_epoch(&self) -> Result<Option<U53>, KeyError> {
        let path = self.dir.join(CURRENT);
        match fs::read_to_string(&path) {
            Ok(text) => {
                check_private(&self.dir)?;
                text.trim()
                    .parse::<u64>()
                    .ok()
                    .and_then(U53::new)
                    .filter(|e| *e >= U53::ONE)
                    .map(Some)
                    .ok_or(KeyError::Corrupt {
                        path,
                        reason: "not a key epoch",
                    })
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(KeyError::Io { path, source: e }),
        }
    }

    /// Every complete epoch directory, ascending.
    pub fn epochs(&self) -> Result<Vec<U53>, KeyError> {
        let entries = match fs::read_dir(&self.dir) {
            Ok(e) => e,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(e) => {
                return Err(KeyError::Io {
                    path: self.dir.clone(),
                    source: e,
                });
            }
        };
        let mut out = Vec::new();
        for entry in entries {
            let entry = entry.map_err(KeyError::io(&self.dir))?;
            let name = entry.file_name();
            if let Some(epoch) = name
                .to_str()
                .and_then(|n| n.strip_prefix("epoch-"))
                .and_then(|n| n.parse::<u64>().ok())
                .and_then(U53::new)
            {
                out.push(epoch);
            }
        }
        out.sort_unstable();
        Ok(out)
    }

    /// Load one epoch's keys.
    pub fn load(&self, epoch: U53) -> Result<NodeKeyset, KeyError> {
        check_private(&self.dir)?;
        let dir = self.epoch_dir(epoch);
        if !dir.exists() {
            return Err(KeyError::Missing(dir));
        }
        check_private(&dir)?;
        let identity = read_secret(&dir.join("identity.key"))?;
        let cache = read_secret(&dir.join("cache.key"))?;
        let wireguard = read_secret(&dir.join("wireguard.key"))?;
        Ok(NodeKeyset::from_secrets(
            epoch, &identity, &cache, &wireguard,
        ))
    }

    /// The current epoch's keys.
    pub fn current(&self) -> Result<NodeKeyset, KeyError> {
        let epoch = self
            .current_epoch()?
            .ok_or_else(|| KeyError::Missing(self.dir.clone()))?;
        self.load(epoch)
    }

    /// Epoch n+1, generated and written on first call, returned unchanged on
    /// every later call until it is activated.
    pub fn prepare_next(&self) -> Result<NodeKeyset, KeyError> {
        let current = self.current()?;
        let next = current.epoch().checked_add(1).ok_or(KeyError::EpochGap {
            current: current.epoch(),
            requested: U53::MAX,
        })?;
        if self.epoch_dir(next).exists() {
            return self.load(next);
        }
        let keys = NodeKeyset::generate(next)?;
        self.write_epoch(&keys)?;
        Ok(keys)
    }

    /// Make `epoch` current. Idempotent; only the prepared next epoch can
    /// become current.
    pub fn activate(&self, epoch: U53) -> Result<NodeKeyset, KeyError> {
        let current = self
            .current_epoch()?
            .ok_or_else(|| KeyError::Missing(self.dir.clone()))?;
        if epoch == current {
            return self.load(epoch);
        }
        if current.checked_add(1) != Some(epoch) {
            return Err(KeyError::EpochGap {
                current,
                requested: epoch,
            });
        }
        let keys = self.load(epoch)?;
        self.write_current(epoch)?;
        Ok(keys)
    }

    /// Bring the store in line with the epoch the journal recorded, then
    /// return the current keys.
    pub fn reconcile(&self, journal_epoch: U53) -> Result<NodeKeyset, KeyError> {
        let store = self
            .current_epoch()?
            .ok_or_else(|| KeyError::Missing(self.dir.clone()))?;
        if store == journal_epoch {
            return self.load(store);
        }
        if store.checked_add(1) == Some(journal_epoch) && self.epoch_dir(journal_epoch).exists() {
            return self.activate(journal_epoch);
        }
        Err(KeyError::Disagrees {
            journal: journal_epoch,
            store,
        })
    }

    /// Delete every epoch older than `keep_from` (after the control plane has
    /// stopped accepting them). Returns the epochs removed.
    pub fn retire_before(&self, keep_from: U53) -> Result<Vec<U53>, KeyError> {
        let current = self
            .current_epoch()?
            .ok_or_else(|| KeyError::Missing(self.dir.clone()))?;
        let keep_from = keep_from.min(current);
        let mut removed = Vec::new();
        for epoch in self.epochs()? {
            if epoch < keep_from {
                let dir = self.epoch_dir(epoch);
                fs::remove_dir_all(&dir).map_err(KeyError::io(&dir))?;
                removed.push(epoch);
            }
        }
        if !removed.is_empty() {
            fsync_dir(&self.dir)?;
        }
        Ok(removed)
    }

    fn write_epoch(&self, keys: &NodeKeyset) -> Result<(), KeyError> {
        let final_dir = self.epoch_dir(keys.epoch());
        let tmp = self
            .dir
            .join(format!("{}.tmp", epoch_dir_name(keys.epoch())));
        if tmp.exists() {
            // A crash while writing: those keys were never returned, so never offered.
            fs::remove_dir_all(&tmp).map_err(KeyError::io(&tmp))?;
        }
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&tmp)
            .map_err(KeyError::io(&tmp))?;
        for (name, secret) in keys.secrets() {
            let encoded = Zeroizing::new(B64.encode(*secret));
            write_new(&tmp.join(format!("{name}.key")), encoded.as_bytes())?;
        }
        fsync_dir(&tmp)?;
        fs::rename(&tmp, &final_dir).map_err(KeyError::io(&final_dir))?;
        fsync_dir(&self.dir)
    }

    fn write_current(&self, epoch: U53) -> Result<(), KeyError> {
        let tmp = self.dir.join(format!("{CURRENT}.tmp"));
        let path = self.dir.join(CURRENT);
        if tmp.exists() {
            fs::remove_file(&tmp).map_err(KeyError::io(&tmp))?;
        }
        write_new(&tmp, format!("{epoch}\n").as_bytes())?;
        fs::rename(&tmp, &path).map_err(KeyError::io(&path))?;
        fsync_dir(&self.dir)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt as _;

    fn store() -> (tempfile::TempDir, KeyStore) {
        let t = tempfile::tempdir().unwrap();
        let s = KeyStore::new(t.path().join("keys"));
        (t, s)
    }

    #[test]
    fn creates_once_with_private_permissions() {
        let (_t, s) = store();
        let k = s.create().unwrap();
        assert_eq!(k.epoch(), U53::ONE);
        assert!(matches!(s.create(), Err(KeyError::Exists(_))));
        let mode = |p: &Path| fs::metadata(p).unwrap().mode() & 0o777;
        assert_eq!(mode(s.dir()), 0o700);
        assert_eq!(mode(&s.epoch_dir(U53::ONE)), 0o700);
        assert_eq!(mode(&s.epoch_dir(U53::ONE).join("identity.key")), 0o600);
        assert_eq!(s.current().unwrap().public(), k.public());
    }

    #[test]
    fn refuses_keys_other_users_can_read() {
        let (_t, s) = store();
        s.create().unwrap();
        let key = s.epoch_dir(U53::ONE).join("wireguard.key");
        fs::set_permissions(&key, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(matches!(s.current(), Err(KeyError::Exposed(p)) if p == key));
    }

    #[test]
    fn rotation_is_prepared_then_activated_and_survives_a_crash_between() {
        let (_t, s) = store();
        let one = s.create().unwrap();
        let two = s.prepare_next().unwrap();
        assert_eq!(two.epoch(), U53::from_const(2));
        // A crash before activation: the same keys come back, current is unchanged.
        let again = KeyStore::new(s.dir()).prepare_next().unwrap();
        assert_eq!(again.public(), two.public());
        assert_eq!(s.current().unwrap().public(), one.public());
        // The journal recorded epoch 2: reconcile activates it.
        assert_eq!(
            s.reconcile(U53::from_const(2)).unwrap().public(),
            two.public()
        );
        assert_eq!(s.current_epoch().unwrap(), Some(U53::from_const(2)));
        assert_eq!(
            s.activate(U53::from_const(2)).unwrap().public(),
            two.public(),
            "idempotent"
        );
        assert_eq!(s.retire_before(U53::from_const(2)).unwrap(), vec![U53::ONE]);
        assert_eq!(s.epochs().unwrap(), vec![U53::from_const(2)]);
    }

    #[test]
    fn the_journal_and_the_store_must_agree() {
        let (_t, s) = store();
        s.create().unwrap();
        assert!(matches!(
            s.reconcile(U53::from_const(2)),
            Err(KeyError::Disagrees { .. })
        ));
        assert!(matches!(
            s.activate(U53::from_const(3)),
            Err(KeyError::EpochGap { .. })
        ));
        s.prepare_next().unwrap();
        assert!(matches!(
            s.reconcile(U53::from_const(3)),
            Err(KeyError::Disagrees { .. })
        ));
        assert!(
            s.reconcile(U53::ONE).is_ok(),
            "prepared but not journalled stays at 1"
        );
    }

    #[test]
    fn a_half_written_epoch_is_discarded() {
        let (_t, s) = store();
        s.create().unwrap();
        let tmp = s.dir().join("epoch-2.tmp");
        fs::create_dir(&tmp).unwrap();
        fs::write(tmp.join("identity.key"), "partial").unwrap();
        let two = s.prepare_next().unwrap();
        assert!(!tmp.exists());
        assert_eq!(s.load(U53::from_const(2)).unwrap().public(), two.public());
    }
}
