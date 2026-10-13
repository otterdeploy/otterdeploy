//! The node's outbound connection to the control plane.
//!
//! otterd dials the control plane; nothing dials the node. One control
//! WebSocket over TLS carries commands, answers, node state and telemetry:
//!
//! * [`handshake`]: `hello` → `welcome` (the control plane's signed session
//!   proof, verified against the pinned control-plane keys) → `authenticate`
//!   (the node's proof) → `ready`. Both proofs cover both nonces.
//! * [`clock`]: the bounded wall clock the session provides. Capabilities are
//!   checked against it; without a fresh reading the node refuses new
//!   privileged work instead of trusting its own clock.
//! * [`credit`]: telemetry is credit-limited and always yields to control
//!   frames; inbound frames and active commands are bounded by the limits the
//!   control plane announced.
//! * [`manager`]: one session at a time, reconnecting with jittered backoff
//!   and honouring `reject`/`goAway` delays, publishing the current session
//!   to the rest of the daemon.

pub mod clock;
mod conn;
pub mod credit;
pub mod handshake;
pub mod manager;
#[cfg(feature = "test-cp")]
pub mod testing;
pub mod tls;

pub use clock::SessionClock;
pub use handshake::{HandshakeError, NodeIdentity};
pub use manager::{
    ConnectionManager, Handler, IdentitySource, Outbox, RequestAnswer, SendError, SessionInfo,
    TransportConfig,
};

/// Why a connection ended or could not be made.
#[derive(Debug, thiserror::Error)]
pub enum TransportError {
    #[error("control URL {0} must be wss://")]
    InsecureUrl(String),
    #[error("tls: {0}")]
    Tls(String),
    #[error("websocket: {0}")]
    WebSocket(#[from] tokio_tungstenite::tungstenite::Error),
    #[error("timed out {0}")]
    Timeout(&'static str),
    #[error(transparent)]
    Handshake(#[from] HandshakeError),
    #[error("protocol violation: {0}")]
    Protocol(String),
    #[error("node identity unavailable: {0}")]
    Identity(String),
}
