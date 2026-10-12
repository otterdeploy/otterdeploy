//! The bulk channel: streams with credit-based flow control (PLAN §5.1).
//!
//! A second WebSocket, authenticated with the same handshake as the control
//! channel (`hello.channel = bulk`, `controlSessionId` set), carries every
//! stream opened by a control-channel command ([`crate::command::StreamBinding`]).
//! Text frames are JSON [`BulkFrame`]s; binary frames are data, prefixed by the
//! 8-byte [`DataHeader`]. A sender may only send as many data bytes as the
//! receiver granted in credit; the per-session queue bound is
//! [`crate::channel::ChannelLimits::bulk_queue_bytes`].

use crate::ids::Sha256Hex;
use crate::num::U53;
use serde::{Deserialize, Serialize};

/// Version byte of the binary data header.
pub const DATA_HEADER_VERSION: u8 = 1;
/// Size of the binary data header.
pub const DATA_HEADER_LEN: usize = 8;

/// Which logical pipe of a stream a data frame belongs to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Pipe {
    /// Process stdin or upload body (CP → node).
    Stdin,
    /// Process stdout, log lines or download body (node → CP).
    Stdout,
    /// Process stderr (node → CP).
    Stderr,
}

impl Pipe {
    #[must_use]
    pub const fn code(self) -> u8 {
        match self {
            Self::Stdin => 0,
            Self::Stdout => 1,
            Self::Stderr => 2,
        }
    }

    #[must_use]
    pub const fn from_code(code: u8) -> Option<Self> {
        match code {
            0 => Some(Self::Stdin),
            1 => Some(Self::Stdout),
            2 => Some(Self::Stderr),
            _ => None,
        }
    }
}

/// `[version u8][pipe u8][reserved u16 = 0][stream id u32 big-endian]`, then data.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DataHeader {
    pub pipe: Pipe,
    pub stream_id: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum DataHeaderError {
    #[error("binary frame shorter than the {DATA_HEADER_LEN}-byte header")]
    Short,
    #[error("unsupported data header version {0}")]
    Version(u8),
    #[error("unknown pipe {0}")]
    Pipe(u8),
    #[error("reserved bytes must be zero")]
    Reserved,
}

impl DataHeader {
    #[must_use]
    pub fn encode(self) -> [u8; DATA_HEADER_LEN] {
        let id = self.stream_id.to_be_bytes();
        [
            DATA_HEADER_VERSION,
            self.pipe.code(),
            0,
            0,
            id[0],
            id[1],
            id[2],
            id[3],
        ]
    }

    /// Split a binary frame into its header and data.
    pub fn decode(frame: &[u8]) -> Result<(Self, &[u8]), DataHeaderError> {
        let (head, data) = frame
            .split_first_chunk::<DATA_HEADER_LEN>()
            .ok_or(DataHeaderError::Short)?;
        let [version, pipe, r0, r1, a, b, c, d] = *head;
        if version != DATA_HEADER_VERSION {
            return Err(DataHeaderError::Version(version));
        }
        if r0 != 0 || r1 != 0 {
            return Err(DataHeaderError::Reserved);
        }
        let pipe = Pipe::from_code(pipe).ok_or(DataHeaderError::Pipe(pipe))?;
        Ok((
            Self {
                pipe,
                stream_id: u32::from_be_bytes([a, b, c, d]),
            },
            data,
        ))
    }
}

/// How a process behind a stream ended.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ExitStatus {
    Code { code: i32 },
    Signal { signal: String },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResetCode {
    /// The receiver exceeded no credit; the sender overran it.
    CreditViolation,
    MaxBytesExceeded,
    DigestMismatch,
    DeadlineExceeded,
    Cancelled,
    UnknownStream,
    Internal,
}

/// JSON text frames on the bulk channel (after the handshake, which reuses
/// [`crate::channel::ControlFrame`]'s `hello`/`welcome`/`authenticate`/`ready`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum BulkFrame {
    /// Grant `bytes` more of credit on `pipe` of `stream_id`.
    #[serde(rename_all = "camelCase")]
    Credit {
        stream_id: u32,
        pipe: Pipe,
        bytes: u32,
    },
    /// Half-close `pipe`: no more data will follow on it. `sha256` covers every
    /// byte sent on the pipe and is verified before an import is committed.
    #[serde(rename_all = "camelCase")]
    End {
        stream_id: u32,
        pipe: Pipe,
        total_bytes: U53,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sha256: Option<Sha256Hex>,
    },
    /// The process behind the stream exited; the stream closes after this.
    #[serde(rename_all = "camelCase")]
    Exit { stream_id: u32, status: ExitStatus },
    /// PTY resize (CP → node).
    #[serde(rename_all = "camelCase")]
    Resize {
        stream_id: u32,
        cols: u16,
        rows: u16,
    },
    /// Abort the stream; a reset generator or WS cancellation closes remote
    /// followers and sessions (PLAN §5.1).
    #[serde(rename_all = "camelCase")]
    Reset {
        stream_id: u32,
        code: ResetCode,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
}

/// Sender-side credit accounting for one pipe.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SendWindow {
    available: u64,
    sent: u64,
    max_bytes: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum WindowError {
    #[error("sending {wanted} bytes exceeds the {available} bytes of credit")]
    NoCredit { wanted: u64, available: u64 },
    #[error("stream would exceed its maximum of {max} bytes")]
    MaxBytes { max: u64 },
}

impl SendWindow {
    #[must_use]
    pub fn new(initial_credit: u32, max_bytes: U53) -> Self {
        Self {
            available: u64::from(initial_credit),
            sent: 0,
            max_bytes: max_bytes.get(),
        }
    }

    /// How many bytes may be sent right now.
    #[must_use]
    pub fn sendable(&self) -> u64 {
        self.available.min(self.max_bytes.saturating_sub(self.sent))
    }

    pub fn consume(&mut self, n: u64) -> Result<(), WindowError> {
        if self.sent.saturating_add(n) > self.max_bytes {
            return Err(WindowError::MaxBytes {
                max: self.max_bytes,
            });
        }
        if n > self.available {
            return Err(WindowError::NoCredit {
                wanted: n,
                available: self.available,
            });
        }
        self.available -= n;
        self.sent += n;
        Ok(())
    }

    pub fn grant(&mut self, bytes: u32) {
        self.available = self.available.saturating_add(u64::from(bytes));
    }

    #[must_use]
    pub fn sent(&self) -> u64 {
        self.sent
    }
}

/// Receiver-side accounting: data beyond granted credit is a protocol violation
/// that resets the stream, never a reason to buffer without bound.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReceiveWindow {
    outstanding: u64,
    received: u64,
    max_bytes: u64,
    window: u32,
    pending: u64,
}

impl ReceiveWindow {
    #[must_use]
    pub fn new(window: u32, max_bytes: U53) -> Self {
        Self {
            outstanding: u64::from(window),
            received: 0,
            max_bytes: max_bytes.get(),
            window,
            pending: 0,
        }
    }

    pub fn accept(&mut self, n: u64) -> Result<(), ResetCode> {
        if self.received.saturating_add(n) > self.max_bytes {
            return Err(ResetCode::MaxBytesExceeded);
        }
        if n > self.outstanding {
            return Err(ResetCode::CreditViolation);
        }
        self.outstanding -= n;
        self.received += n;
        Ok(())
    }

    /// Record that the consumer drained `consumed` bytes; returns the credit to
    /// grant back, batched until at least half the window is free.
    pub fn replenish(&mut self, consumed: u64) -> Option<u32> {
        let free = u64::from(self.window).saturating_sub(self.outstanding);
        self.pending = self.pending.saturating_add(consumed).min(free);
        if self.pending > 0 && self.pending >= u64::from(self.window / 2) {
            let grant = self.pending;
            self.pending = 0;
            self.outstanding += grant;
            u32::try_from(grant).ok()
        } else {
            None
        }
    }

    #[must_use]
    pub fn received(&self) -> u64 {
        self.received
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_header_round_trips_and_rejects_junk() {
        let h = DataHeader {
            pipe: Pipe::Stderr,
            stream_id: 0x0102_0304,
        };
        let mut frame = h.encode().to_vec();
        frame.extend_from_slice(b"abc");
        let (back, data) = DataHeader::decode(&frame).unwrap();
        assert_eq!(back, h);
        assert_eq!(data, b"abc");
        assert_eq!(DataHeader::decode(&frame[..7]), Err(DataHeaderError::Short));
        let mut bad = frame.clone();
        bad[0] = 2;
        assert_eq!(DataHeader::decode(&bad), Err(DataHeaderError::Version(2)));
        let mut bad = frame.clone();
        bad[1] = 9;
        assert_eq!(DataHeader::decode(&bad), Err(DataHeaderError::Pipe(9)));
        let mut bad = frame;
        bad[2] = 1;
        assert_eq!(DataHeader::decode(&bad), Err(DataHeaderError::Reserved));
    }

    #[test]
    fn sender_never_exceeds_credit_or_max_bytes() {
        let mut w = SendWindow::new(10, U53::from_const(15));
        assert_eq!(w.sendable(), 10);
        w.consume(10).unwrap();
        assert!(matches!(w.consume(1), Err(WindowError::NoCredit { .. })));
        w.grant(100);
        assert_eq!(w.sendable(), 5);
        assert!(matches!(w.consume(6), Err(WindowError::MaxBytes { .. })));
        w.consume(5).unwrap();
        assert_eq!(w.sent(), 15);
    }

    #[test]
    fn receiver_resets_on_overrun_and_batches_credit() {
        let mut r = ReceiveWindow::new(8, U53::from_const(100));
        r.accept(8).unwrap();
        assert_eq!(r.accept(1), Err(ResetCode::CreditViolation));
        assert_eq!(r.replenish(3), None);
        assert_eq!(r.replenish(4), Some(7));
        r.accept(4).unwrap();
        let mut small = ReceiveWindow::new(8, U53::from_const(5));
        assert_eq!(small.accept(6), Err(ResetCode::MaxBytesExceeded));
    }
}
