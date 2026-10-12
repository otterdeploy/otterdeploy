//! The on-disk journal: an 8-byte header followed by length/CRC32C-framed JSON
//! entries.
//!
//! ```text
//! header:  b"ODJ1" | u32 LE journal format
//! frame:   u32 LE payload length | u32 LE crc32c(payload) | payload (JSON Entry)
//! ```
//!
//! Every append is `write_all` + `fdatasync` before it returns, so a caller may
//! cross the Engine boundary only after the record is durable. On open, a torn
//! final frame (crash mid-append) is truncated; a bad frame followed by more data
//! is corruption and the journal refuses to open: that is journal loss, which is
//! recovery, never silent adoption (MODEL §2.4).

use crate::state::{NodeState, TransitionError};
use otterd_proto::U53;
use otterd_proto::journal::{
    Entry, FILE_HEADER_LEN, FILE_MAGIC, FRAME_HEADER_LEN, MAX_ENTRY_BYTES, Record,
};
use otterd_proto::version::JOURNAL_FORMAT;
use std::fs::{File, OpenOptions};
use std::io::{Read as _, Seek as _, SeekFrom, Write as _};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, thiserror::Error)]
pub enum JournalError {
    #[error("journal i/o at {path}: {source}")]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("journal {path} is missing: no trusted ownership inventory")]
    Missing { path: PathBuf },
    #[error("journal {path} already exists")]
    AlreadyExists { path: PathBuf },
    #[error("journal {path} is locked by another process")]
    Locked { path: PathBuf },
    #[error("journal {path} is corrupt at offset {offset}: {reason}")]
    Corrupt {
        path: PathBuf,
        offset: u64,
        reason: String,
    },
    #[error("journal transition rejected: {0}")]
    Transition(#[from] TransitionError),
    #[error("journal encode: {0}")]
    Encode(#[from] serde_json::Error),
    #[error("journal entry of {0} bytes exceeds the frame limit")]
    TooLarge(usize),
    #[error("journal sequence exhausted")]
    SequenceExhausted,
    #[error("compaction would change the journal's obligations; refusing: {0}")]
    CompactionMismatch(String),
}

/// Result of opening a journal, for the operator log.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OpenReport {
    pub entries: u64,
    pub truncated_torn_tail_bytes: u64,
}

/// An open, exclusively locked, append-only journal and its folded state.
#[derive(Debug)]
pub struct Journal {
    path: PathBuf,
    file: File,
    state: NodeState,
    next_seq: U53,
    end: u64,
}

pub(crate) fn io_err(path: &Path) -> impl Fn(std::io::Error) -> JournalError + '_ {
    move |source| JournalError::Io {
        path: path.to_owned(),
        source,
    }
}

impl Journal {
    /// Create a new journal whose first record is `format`. Refuses to overwrite:
    /// an existing journal is authority.
    pub fn create(path: &Path, otterd_version: &str) -> Result<Self, JournalError> {
        let mut journal = Self::create_empty(path, U53::ONE)?;
        journal.append_unchecked_live(Record::Format {
            journal_format: JOURNAL_FORMAT,
            otterd_version: otterd_version.to_owned(),
        })?;
        Ok(journal)
    }

    /// A new file with only the header; the first append must be `format`.
    pub(crate) fn create_empty(path: &Path, first_seq: U53) -> Result<Self, JournalError> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(io_err(path))?;
        }
        let mut file = OpenOptions::new()
            .read(true)
            .append(true)
            .create_new(true)
            .open(path)
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::AlreadyExists => JournalError::AlreadyExists {
                    path: path.to_owned(),
                },
                _ => io_err(path)(e),
            })?;
        lock(&file, path)?;
        let mut header = Vec::with_capacity(FILE_HEADER_LEN);
        header.extend_from_slice(FILE_MAGIC);
        header.extend_from_slice(&u32::from(JOURNAL_FORMAT).to_le_bytes());
        file.write_all(&header).map_err(io_err(path))?;
        file.sync_all().map_err(io_err(path))?;
        sync_dir(path)?;
        Ok(Self {
            path: path.to_owned(),
            file,
            state: NodeState::default(),
            next_seq: first_seq,
            end: FILE_HEADER_LEN as u64,
        })
    }

    /// Open and replay an existing journal, taking the exclusive lock and
    /// truncating a torn final frame.
    pub fn open(path: &Path) -> Result<(Self, OpenReport), JournalError> {
        let file = OpenOptions::new()
            .read(true)
            .append(true)
            .open(path)
            .map_err(|e| missing_or_io(path, e))?;
        lock(&file, path)?;
        Self::replay(path, file, true)
    }

    /// Read-only fold for the recovery CLI: no lock, never truncates.
    pub fn read_snapshot(path: &Path) -> Result<(NodeState, OpenReport), JournalError> {
        let file = File::open(path).map_err(|e| missing_or_io(path, e))?;
        let (journal, report) = Self::replay(path, file, false)?;
        Ok((journal.state, report))
    }

    fn replay(
        path: &Path,
        mut file: File,
        repair: bool,
    ) -> Result<(Self, OpenReport), JournalError> {
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).map_err(io_err(path))?;
        let corrupt = |offset: usize, reason: String| JournalError::Corrupt {
            path: path.to_owned(),
            offset: offset as u64,
            reason,
        };
        let (header, mut rest) = bytes
            .split_first_chunk::<FILE_HEADER_LEN>()
            .ok_or_else(|| corrupt(0, "short header".into()))?;
        let [m0, m1, m2, m3, v0, v1, v2, v3] = *header;
        if &[m0, m1, m2, m3] != FILE_MAGIC {
            return Err(corrupt(0, "bad magic".into()));
        }
        let format = u32::from_le_bytes([v0, v1, v2, v3]);
        if format != u32::from(JOURNAL_FORMAT) {
            return Err(corrupt(4, format!("unsupported journal format {format}")));
        }
        let mut state = NodeState::default();
        let mut offset = FILE_HEADER_LEN;
        let mut report = OpenReport::default();
        let mut next_seq: Option<U53> = None;
        while !rest.is_empty() {
            match parse_frame(rest) {
                Frame::Ok { payload, len } => {
                    let entry: Entry = serde_json::from_slice(payload)
                        .map_err(|e| corrupt(offset, format!("undecodable entry: {e}")))?;
                    if let Some(want) = next_seq
                        && entry.seq != want
                    {
                        return Err(corrupt(
                            offset,
                            format!("sequence gap: want {want}, got {}", entry.seq),
                        ));
                    }
                    state
                        .apply(&entry)
                        .map_err(|e| corrupt(offset, format!("illegal transition: {e}")))?;
                    next_seq = Some(entry.seq.next().ok_or(JournalError::SequenceExhausted)?);
                    report.entries += 1;
                    offset += len;
                    rest = rest.get(len..).unwrap_or_default();
                }
                // Only a torn *final* frame is a crash artifact; anything else is corruption.
                Frame::Torn => {
                    report.truncated_torn_tail_bytes = rest.len() as u64;
                    break;
                }
                Frame::BadCrc { len } if len >= rest.len() => {
                    report.truncated_torn_tail_bytes = rest.len() as u64;
                    break;
                }
                Frame::BadCrc { .. } => {
                    return Err(corrupt(offset, "crc mismatch before end of log".into()));
                }
                Frame::TooLarge => {
                    return Err(corrupt(offset, "frame length exceeds limit".into()));
                }
            }
        }
        if state.format.is_none() {
            return Err(corrupt(offset, "journal has no format record".into()));
        }
        if report.truncated_torn_tail_bytes > 0 && repair {
            tracing::warn!(
                path = %path.display(),
                bytes = report.truncated_torn_tail_bytes,
                "truncating torn journal tail"
            );
            file.set_len(offset as u64).map_err(io_err(path))?;
            file.sync_all().map_err(io_err(path))?;
        }
        file.seek(SeekFrom::Start(offset as u64))
            .map_err(io_err(path))?;
        Ok((
            Self {
                path: path.to_owned(),
                file,
                state,
                next_seq: next_seq.unwrap_or(U53::ONE),
                end: offset as u64,
            },
            report,
        ))
    }

    #[must_use]
    pub fn state(&self) -> &NodeState {
        &self.state
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Validate (including append-time policy), append, fdatasync, then fold.
    /// On any error the in-memory state is unchanged and the caller must not
    /// perform the side effect the record would authorize.
    pub fn append(&mut self, record: Record) -> Result<U53, JournalError> {
        self.state.check_live(&record)?;
        self.write(record)
    }

    /// Append with history rules only (compaction rewrites history).
    pub(crate) fn append_unchecked_live(&mut self, record: Record) -> Result<U53, JournalError> {
        self.state.check(&record)?;
        self.write(record)
    }

    /// Compaction re-records history with the original claim time.
    pub(crate) fn append_at(
        &mut self,
        record: Record,
        at: Option<U53>,
    ) -> Result<U53, JournalError> {
        self.state.check(&record)?;
        self.write_entry(record, at.unwrap_or_else(now_unix_ms))
    }

    fn write(&mut self, record: Record) -> Result<U53, JournalError> {
        self.write_entry(record, now_unix_ms())
    }

    fn write_entry(&mut self, record: Record, at_unix_ms: U53) -> Result<U53, JournalError> {
        let entry = Entry {
            seq: self.next_seq,
            at_unix_ms,
            record,
        };
        let payload = serde_json::to_vec(&entry)?;
        let len = u32::try_from(payload.len())
            .ok()
            .filter(|l| *l <= MAX_ENTRY_BYTES)
            .ok_or(JournalError::TooLarge(payload.len()))?;
        let mut frame = Vec::with_capacity(FRAME_HEADER_LEN + payload.len());
        frame.extend_from_slice(&len.to_le_bytes());
        frame.extend_from_slice(&crc32c::crc32c(&payload).to_le_bytes());
        frame.extend_from_slice(&payload);
        if let Err(e) = self
            .file
            .write_all(&frame)
            .and_then(|()| self.file.sync_data())
        {
            // Cut any partial frame so the next open does not find garbage
            // mid-log. If this also fails, the next open sees a torn tail.
            if self.file.set_len(self.end).is_err() {
                tracing::error!(path = %self.path.display(), "could not cut a failed append");
            }
            return Err(io_err(&self.path)(e));
        }
        self.end += frame.len() as u64;
        self.state.apply(&entry)?;
        self.next_seq = entry.seq.next().ok_or(JournalError::SequenceExhausted)?;
        Ok(entry.seq)
    }

    /// Size of the file in bytes.
    #[must_use]
    pub fn len_bytes(&self) -> u64 {
        self.end
    }

    pub(crate) fn next_seq(&self) -> U53 {
        self.next_seq
    }

    /// After a rename, the open file lives at `path`.
    pub(crate) fn with_path(mut self, path: PathBuf) -> Self {
        self.path = path;
        self
    }
}

enum Frame<'a> {
    Ok { payload: &'a [u8], len: usize },
    Torn,
    BadCrc { len: usize },
    TooLarge,
}

fn parse_frame(buf: &[u8]) -> Frame<'_> {
    let Some((head, body)) = buf.split_first_chunk::<FRAME_HEADER_LEN>() else {
        return Frame::Torn;
    };
    let [l0, l1, l2, l3, c0, c1, c2, c3] = *head;
    let len = u32::from_le_bytes([l0, l1, l2, l3]);
    if len > MAX_ENTRY_BYTES {
        return Frame::TooLarge;
    }
    let crc = u32::from_le_bytes([c0, c1, c2, c3]);
    let Some(payload) = body.get(..len as usize) else {
        return Frame::Torn;
    };
    let total = FRAME_HEADER_LEN + len as usize;
    if crc32c::crc32c(payload) == crc {
        Frame::Ok {
            payload,
            len: total,
        }
    } else {
        Frame::BadCrc { len: total }
    }
}

fn missing_or_io(path: &Path, e: std::io::Error) -> JournalError {
    if e.kind() == std::io::ErrorKind::NotFound {
        JournalError::Missing {
            path: path.to_owned(),
        }
    } else {
        io_err(path)(e)
    }
}

fn lock(file: &File, path: &Path) -> Result<(), JournalError> {
    file.try_lock().map_err(|e| match e {
        std::fs::TryLockError::WouldBlock => JournalError::Locked {
            path: path.to_owned(),
        },
        std::fs::TryLockError::Error(source) => JournalError::Io {
            path: path.to_owned(),
            source,
        },
    })
}

pub(crate) fn sync_dir(path: &Path) -> Result<(), JournalError> {
    if let Some(dir) = path.parent() {
        File::open(dir)
            .and_then(|d| d.sync_all())
            .map_err(io_err(dir))?;
    }
    Ok(())
}

/// Wall-clock milliseconds, for evidence only (never orders authority).
#[must_use]
pub fn now_unix_ms() -> U53 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|d| u64::try_from(d.as_millis()).ok())
        .and_then(U53::new)
        .unwrap_or(U53::ZERO)
}
