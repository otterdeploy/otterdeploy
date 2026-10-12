//! The control channel.
//!
//! otterd dials `wss://<control-plane>/api/otterd/connect` and stays connected.
//! Each WebSocket text frame is one JSON [`ControlFrame`], at most
//! [`ChannelLimits::max_frame_bytes`]. A second WebSocket, the bulk channel
//! ([`crate::bulk`]), carries streams and binds to the same session.
//!
//! Handshake, in order, before anything else is accepted:
//!
//! 1. node → `hello` (versions, identity, a fresh node nonce);
//! 2. CP → `welcome` (selected version, session id, CP nonce, term, time, limits,
//!    and the CP's signed [`SessionProof`] over both nonces) or `reject`;
//! 3. node verifies the CP proof against its pinned keys, then → `authenticate`
//!    with its own signed proof;
//! 4. CP verifies the node proof against the enrolled identity key → `ready`.
//!
//! The node learns the authority term and a bounded wall-clock reading from the
//! authenticated `welcome` and `pong` frames; without them it refuses new
//! privileged operations.

use crate::capability::CapabilityError;
use crate::command::OpOutcome;
use crate::discovery::DiscoveryMessage;
use crate::envelope::SignedEnvelope;
use crate::identity::{CrossSigned, HostFacts};
use crate::ids::{BatchId, BootId, Incarnation, InstallId, KeyId, NodeId, Nonce, OpId, SessionId};
use crate::lifecycle::{LeaseRequest, SlotReport};
use crate::metrics::{BatchDisposition, SampleBatch};
use crate::num::{DurationMs, U53, UnixMs};
use crate::version::{Feature, VersionRange};
use serde::{Deserialize, Serialize};

/// Which WebSocket a handshake is for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ChannelKind {
    Control,
    Bulk,
}

/// Limits the CP announces in `welcome`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChannelLimits {
    pub max_frame_bytes: u32,
    pub max_active_commands: u16,
    pub control_reserve_bytes: u32,
    pub bulk_queue_bytes: u32,
    pub stream_window_bytes: u32,
    pub max_streams: u16,
    /// Telemetry items the node may send before an acknowledgement.
    pub telemetry_credit: u32,
}

impl ChannelLimits {
    pub const DEFAULT: Self = Self {
        max_frame_bytes: 64 * 1024,
        max_active_commands: 16,
        control_reserve_bytes: 256 * 1024,
        bulk_queue_bytes: 2 * 1024 * 1024,
        stream_window_bytes: 256 * 1024,
        max_streams: 16,
        telemetry_credit: 4_000,
    };
}

impl Default for ChannelLimits {
    fn default() -> Self {
        Self::DEFAULT
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SessionRole {
    Hub,
    Node,
}

/// What each end signs under `otterd/session/v1`. Both proofs cover both
/// nonces, so neither can be replayed into another session.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionProof {
    pub role: SessionRole,
    pub channel: ChannelKind,
    pub protocol: u16,
    pub install_id: InstallId,
    pub session_id: SessionId,
    pub node_id: NodeId,
    pub node_epoch: U53,
    pub boot_id: BootId,
    pub incarnation: Incarnation,
    pub node_nonce: Nonce,
    pub cp_nonce: Nonce,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hello {
    pub protocol: VersionRange,
    pub channel: ChannelKind,
    pub install_id: InstallId,
    pub node_id: NodeId,
    pub node_epoch: U53,
    pub key_epoch: U53,
    pub identity_key_id: KeyId,
    pub boot_id: BootId,
    pub incarnation: Incarnation,
    pub otterd_version: String,
    pub journal_format: u16,
    pub features: Vec<Feature>,
    pub node_nonce: Nonce,
    /// Bulk channel only: the control session it belongs to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub control_session_id: Option<SessionId>,
    /// Control channel only: static facts, once per connection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub facts: Option<HostFacts>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Welcome {
    /// The negotiated protocol version.
    pub protocol: u16,
    pub session_id: SessionId,
    pub cp_nonce: Nonce,
    pub authority_term: U53,
    /// CP wall clock when this frame was built; the node bounds its uncertainty
    /// by the handshake round trip.
    pub cp_unix_ms: UnixMs,
    pub limits: ChannelLimits,
    pub features: Vec<Feature>,
    /// Signed [`SessionProof`] with `role = hub`.
    pub hub_proof: SignedEnvelope,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RejectCode {
    UnsupportedProtocol,
    UnknownNode,
    Revoked,
    StaleEpoch,
    WrongInstall,
    BadProof,
    RateLimited,
    /// Another control session is live for this node; the newer one wins only
    /// after the older one is closed by the CP.
    SessionConflict,
    Maintenance,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reject {
    pub code: RejectCode,
    pub message: String,
    /// The CP's range, so the operator sees which side must upgrade.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supported: Option<VersionRange>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<DurationMs>,
}

/// One control-channel frame. Internally tagged by `type`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ControlFrame {
    // ---- handshake ----
    Hello(Box<Hello>),
    Welcome(Box<Welcome>),
    Reject(Reject),
    /// node → CP: signed [`SessionProof`] with `role = node`.
    #[serde(rename_all = "camelCase")]
    Authenticate {
        session_id: SessionId,
        node_proof: SignedEnvelope,
    },
    #[serde(rename_all = "camelCase")]
    Ready {
        session_id: SessionId,
    },

    // ---- commands (CP → node) ----
    /// `capability` is a signed [`crate::capability::Capability`]; `payload` is
    /// the exact JSON text of a [`crate::command::Command`] whose SHA-256 the
    /// capability binds. `id` is unique among this session's active requests.
    Request {
        id: u32,
        capability: SignedEnvelope,
        payload: String,
    },
    /// Cancel the generator or stream behind `id`. Committed work is governed by
    /// its operation state, not by cancellation.
    Cancel {
        id: u32,
        reason: String,
    },

    // ---- answers (node → CP) ----
    #[serde(rename_all = "camelCase")]
    Progress {
        id: u32,
        op_id: OpId,
        seq: u32,
        phase: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    /// `duplicate` = the `opId` was already claimed with the same payload; the
    /// recorded outcome is returned instead of executing again.
    #[serde(rename_all = "camelCase")]
    Response {
        id: u32,
        op_id: OpId,
        duplicate: bool,
        outcome: OpOutcome,
    },
    /// Refused before parsing a capability (malformed frame, too many active
    /// commands). No opId is known.
    RequestRefused {
        id: u32,
        error: RequestRefusal,
    },

    // ---- node state (node → CP) ----
    /// Journalled slot state, sent after `ready` and on every change.
    #[serde(rename_all = "camelCase")]
    SlotReports {
        seq: U53,
        quarantined: bool,
        engine_reachable: bool,
        slots: Vec<SlotReport>,
    },
    LeaseRequest(LeaseRequest),
    /// CP → node: signed [`crate::lifecycle::LeaseRenewal`].
    Lease {
        renewal: SignedEnvelope,
    },

    // ---- telemetry ----
    Telemetry(SampleBatch),
    #[serde(rename_all = "camelCase")]
    TelemetryAck {
        batch_id: BatchId,
        disposition: BatchDisposition,
        credit: u32,
    },

    // ---- discovery relay ----
    #[serde(rename_all = "camelCase")]
    Discovery {
        from: NodeId,
        to: NodeId,
        message: DiscoveryMessage,
    },
    /// CP → node: signed serving set, membership or authority revocation.
    #[serde(rename_all = "camelCase")]
    Authority {
        document: SignedEnvelope,
    },

    // ---- keys (feature `key-rotation`) ----
    /// node → CP: a node key rotation, signed by the outgoing and incoming
    /// identity keys. Re-sent unchanged until acknowledged.
    KeyRotation {
        statement: CrossSigned,
    },
    /// CP → node: signed [`crate::identity::KeyRotationAck`]. Only then does
    /// the node switch to the new key epoch.
    KeyRotationAck {
        ack: SignedEnvelope,
    },
    /// CP → node: a [`crate::identity::CpKeyTransition`] signed by the outgoing
    /// and the incoming control-plane key.
    CpKeyTransition {
        transition: CrossSigned,
    },
    /// node → CP: the transition is journalled; the node now trusts the
    /// incoming key and keeps the outgoing one until its end of validity.
    #[serde(rename_all = "camelCase")]
    CpKeyTransitionAck {
        key_id: KeyId,
        epoch: U53,
    },

    // ---- liveness and time ----
    #[serde(rename_all = "camelCase")]
    Ping {
        seq: u32,
        node_mono_ms: U53,
    },
    #[serde(rename_all = "camelCase")]
    Pong {
        seq: u32,
        node_mono_ms: U53,
        cp_unix_ms: UnixMs,
    },
    #[serde(rename_all = "camelCase")]
    GoAway {
        code: RejectCode,
        message: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reconnect_after_ms: Option<DurationMs>,
    },
}

/// Refusals that happen before a capability can be checked.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[serde(tag = "code", rename_all = "kebab-case")]
pub enum RequestRefusal {
    #[error("too many active commands")]
    Busy,
    #[error("duplicate request id")]
    DuplicateId,
    #[error("malformed request: {detail}")]
    Malformed { detail: String },
    #[error("capability rejected: {error}")]
    Capability { error: CapabilityError },
    #[error("payload verb does not match the capability")]
    VerbMismatch,
    #[error("payload opId does not match the capability")]
    OpMismatch,
}

impl ControlFrame {
    /// Stable name of the frame type, for logs and metrics.
    #[must_use]
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Hello(_) => "hello",
            Self::Welcome(_) => "welcome",
            Self::Reject(_) => "reject",
            Self::Authenticate { .. } => "authenticate",
            Self::Ready { .. } => "ready",
            Self::Request { .. } => "request",
            Self::Cancel { .. } => "cancel",
            Self::Progress { .. } => "progress",
            Self::Response { .. } => "response",
            Self::RequestRefused { .. } => "requestRefused",
            Self::SlotReports { .. } => "slotReports",
            Self::LeaseRequest(_) => "leaseRequest",
            Self::Lease { .. } => "lease",
            Self::Telemetry(_) => "telemetry",
            Self::TelemetryAck { .. } => "telemetryAck",
            Self::Discovery { .. } => "discovery",
            Self::Authority { .. } => "authority",
            Self::KeyRotation { .. } => "keyRotation",
            Self::KeyRotationAck { .. } => "keyRotationAck",
            Self::CpKeyTransition { .. } => "cpKeyTransition",
            Self::CpKeyTransitionAck { .. } => "cpKeyTransitionAck",
            Self::Ping { .. } => "ping",
            Self::Pong { .. } => "pong",
            Self::GoAway { .. } => "goAway",
        }
    }
}

/// Wall-clock bound from a ping round trip: the CP time lies within
/// `cp_unix_ms ± rtt/2` of the node's midpoint reading.
#[must_use]
pub fn clock_from_round_trip(
    sent_mono_ms: u64,
    received_mono_ms: u64,
    cp_unix_ms: UnixMs,
) -> (UnixMs, DurationMs) {
    let rtt = received_mono_ms.saturating_sub(sent_mono_ms);
    let half = rtt.div_ceil(2);
    (cp_unix_ms, U53::from_const(half))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_are_tagged_by_type() {
        let f = ControlFrame::Ping {
            seq: 1,
            node_mono_ms: U53::from_const(10),
        };
        let json = serde_json::to_string(&f).unwrap();
        assert_eq!(json, r#"{"type":"ping","seq":1,"nodeMonoMs":10}"#);
        let back: ControlFrame = serde_json::from_str(&json).unwrap();
        assert_eq!(back.kind(), "ping");
        assert_eq!(back, f);
    }

    #[test]
    fn round_trip_clock_bound() {
        let (t, u) = clock_from_round_trip(1_000, 1_041, U53::from_const(5));
        assert_eq!(t.get(), 5);
        assert_eq!(u.get(), 21);
    }
}
