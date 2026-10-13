//! One control session at a time, reconnecting forever.

use crate::clock::SessionClock;
use crate::handshake::{HandshakeError, NodeIdentity};
use crate::{TransportError, conn};
use otterd_proto::U53;
use otterd_proto::capability::ClockBound;
use otterd_proto::channel::{ChannelLimits, ControlFrame, RejectCode, RequestRefusal};
use otterd_proto::command::OpOutcome;
use otterd_proto::envelope::SignedEnvelope;
use otterd_proto::ids::{OpId, SessionId};
use otterd_proto::metrics::SampleBatch;
use otterd_proto::version::Feature;
use std::future::Future;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{mpsc, watch};

/// Batches waiting for the connection; beyond this the collector keeps them.
const TELEMETRY_QUEUE: usize = 8;

#[derive(Debug, Clone)]
pub struct TransportConfig {
    /// `wss://…/api/otterd/connect`; plain `ws://` is refused.
    pub url: String,
    pub tls: Arc<rustls::ClientConfig>,
    pub connect_timeout: Duration,
    pub handshake_timeout: Duration,
    pub ping_interval: Duration,
    /// No pong for this long closes the session.
    pub pong_timeout: Duration,
    /// A clock reading older than this is no reading.
    pub clock_max_age: Duration,
    pub backoff_min: Duration,
    pub backoff_max: Duration,
}

impl TransportConfig {
    #[must_use]
    pub fn new(url: impl Into<String>, tls: Arc<rustls::ClientConfig>) -> Self {
        Self {
            url: url.into(),
            tls,
            connect_timeout: Duration::from_secs(10),
            handshake_timeout: Duration::from_secs(10),
            ping_interval: Duration::from_secs(10),
            pong_timeout: Duration::from_secs(25),
            clock_max_age: Duration::from_secs(60),
            backoff_min: Duration::from_millis(500),
            backoff_max: Duration::from_secs(30),
        }
    }
}

/// The live session, as the rest of the daemon sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionInfo {
    pub session_id: SessionId,
    pub protocol: u16,
    pub authority_term: U53,
    pub limits: ChannelLimits,
    pub features: Vec<Feature>,
    pub clock: SessionClock,
}

impl SessionInfo {
    /// The bounded clock now, or `None` when the reading is too old.
    #[must_use]
    pub fn clock_now(&self) -> Option<ClockBound> {
        self.clock.now()
    }

    #[must_use]
    pub fn has(&self, feature: Feature) -> bool {
        self.features.contains(&feature)
    }
}

/// How a request ended, before the transport adds its request id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RequestAnswer {
    Outcome {
        op_id: OpId,
        duplicate: bool,
        outcome: OpOutcome,
    },
    Refused(RequestRefusal),
}

/// Where the node's current identity comes from; read before every connection.
pub trait IdentitySource: Send + Sync + 'static {
    fn identity(&self) -> Result<NodeIdentity, String>;
}

/// The daemon's side of a session.
pub trait Handler: Send + Sync + 'static {
    /// Frames to send right after `ready` (slot reports).
    fn on_ready(&self, session: SessionInfo) -> impl Future<Output = Vec<ControlFrame>> + Send;
    /// A command. Runs concurrently with other commands, up to the
    /// announced `maxActiveCommands`.
    fn request(
        &self,
        session: SessionInfo,
        capability: SignedEnvelope,
        payload: String,
    ) -> impl Future<Output = RequestAnswer> + Send;
    /// Any other frame from the control plane; returns frames to send back.
    fn frame(
        &self,
        session: SessionInfo,
        frame: ControlFrame,
    ) -> impl Future<Output = Vec<ControlFrame>> + Send;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum SendError {
    #[error("no control session")]
    NotConnected,
    #[error("telemetry queue full")]
    TelemetryFull,
}

/// What the daemon queues on the control channel.
#[derive(Debug)]
pub(crate) enum Outgoing {
    Frame(Box<ControlFrame>),
    /// End this session and connect again (the node identity changed).
    Reconnect,
}

#[derive(Debug)]
pub(crate) struct Channels {
    pub(crate) control: mpsc::UnboundedSender<Outgoing>,
    pub(crate) telemetry: mpsc::Sender<SampleBatch>,
}

/// Sends frames on whichever session is live.
#[derive(Debug, Clone, Default)]
pub struct Outbox {
    inner: Arc<Mutex<Option<Channels>>>,
}

impl Outbox {
    fn set(&self, channels: Option<Channels>) {
        if let Ok(mut g) = self.inner.lock() {
            *g = channels;
        }
    }

    /// A control frame (slot reports, lease requests, key rotation). Control
    /// frames are never dropped while connected and always go before telemetry.
    pub fn send(&self, frame: ControlFrame) -> Result<(), SendError> {
        let g = self.inner.lock().map_err(|_| SendError::NotConnected)?;
        g.as_ref()
            .ok_or(SendError::NotConnected)?
            .control
            .send(Outgoing::Frame(Box::new(frame)))
            .map_err(|_| SendError::NotConnected)
    }

    /// End the current session after the frames already queued, and connect
    /// again: used when the node's identity key changed.
    pub fn reconnect(&self) -> Result<(), SendError> {
        let g = self.inner.lock().map_err(|_| SendError::NotConnected)?;
        g.as_ref()
            .ok_or(SendError::NotConnected)?
            .control
            .send(Outgoing::Reconnect)
            .map_err(|_| SendError::NotConnected)
    }

    /// A telemetry batch; sent when credit allows. `TelemetryFull` means keep it.
    pub fn send_telemetry(&self, batch: SampleBatch) -> Result<(), SendError> {
        let g = self.inner.lock().map_err(|_| SendError::NotConnected)?;
        g.as_ref()
            .ok_or(SendError::NotConnected)?
            .telemetry
            .try_send(batch)
            .map_err(|e| match e {
                mpsc::error::TrySendError::Full(_) => SendError::TelemetryFull,
                mpsc::error::TrySendError::Closed(_) => SendError::NotConnected,
            })
    }
}

#[derive(Debug)]
pub struct ConnectionManager<H, I> {
    cfg: TransportConfig,
    handler: Arc<H>,
    identity: Arc<I>,
    sessions: watch::Sender<Option<SessionInfo>>,
    outbox: Outbox,
}

/// Exponential backoff, capped.
fn backoff(cfg: &TransportConfig, failures: u32) -> Duration {
    let factor = 1u32.checked_shl(failures.min(16)).unwrap_or(u32::MAX);
    cfg.backoff_min.saturating_mul(factor).min(cfg.backoff_max)
}

/// Between half and all of `delay`, so a restarted control plane is not hit
/// by every node at once.
fn jitter(delay: Duration) -> Duration {
    let mut b = [0u8; 4];
    let r = getrandom::fill(&mut b).map_or(0, |()| u32::from_le_bytes(b));
    let half = delay / 2;
    half + half.mul_f64(f64::from(r) / f64::from(u32::MAX))
}

impl<H: Handler, I: IdentitySource> ConnectionManager<H, I> {
    pub fn new(cfg: TransportConfig, handler: Arc<H>, identity: Arc<I>) -> Self {
        Self {
            cfg,
            handler,
            identity,
            sessions: watch::channel(None).0,
            outbox: Outbox::default(),
        }
    }

    /// The current session; `None` while disconnected.
    #[must_use]
    pub fn sessions(&self) -> watch::Receiver<Option<SessionInfo>> {
        self.sessions.subscribe()
    }

    #[must_use]
    pub fn outbox(&self) -> Outbox {
        self.outbox.clone()
    }

    /// Connect, serve, reconnect, until `shutdown` turns true.
    pub async fn run(&self, mut shutdown: watch::Receiver<bool>) {
        let mut failures = 0u32;
        loop {
            if *shutdown.borrow() {
                return;
            }
            let delay = match self.identity.identity() {
                Err(e) => {
                    failures = failures.saturating_add(1);
                    tracing::warn!(error = %e, "node identity unavailable; not connecting");
                    backoff(&self.cfg, failures)
                }
                Ok(id) => match Box::pin(conn::connect(&self.cfg, &id)).await {
                    Ok((ws, session)) => {
                        failures = 0;
                        tracing::info!(session = %session.session_id, term = %session.authority_term,
                            protocol = session.protocol, "control session ready");
                        let (control, control_rx) = mpsc::unbounded_channel();
                        let (telemetry, telemetry_rx) = mpsc::channel(TELEMETRY_QUEUE);
                        self.outbox.set(Some(Channels { control, telemetry }));
                        self.sessions.send_replace(Some(session.clone()));
                        let ended = conn::serve(
                            ws,
                            session,
                            &self.handler,
                            &self.cfg,
                            control_rx,
                            telemetry_rx,
                            &self.sessions,
                            &mut shutdown,
                        )
                        .await;
                        self.outbox.set(None);
                        self.sessions.send_replace(None);
                        tracing::warn!(reason = %ended, "control session ended");
                        match ended {
                            conn::Ended::Shutdown => return,
                            conn::Ended::GoAway { after: Some(d) } => d,
                            conn::Ended::Reconnect => Duration::ZERO,
                            _ => self.cfg.backoff_min,
                        }
                    }
                    Err(TransportError::Handshake(HandshakeError::Rejected(r))) => {
                        failures = failures.saturating_add(1);
                        tracing::warn!(code = ?r.code, message = %r.message, "control plane rejected the session");
                        match (r.retry_after_ms, r.code) {
                            (Some(ms), _) => Duration::from_millis(ms.get()),
                            (
                                None,
                                RejectCode::Revoked
                                | RejectCode::StaleEpoch
                                | RejectCode::WrongInstall
                                | RejectCode::UnknownNode
                                | RejectCode::UnsupportedProtocol,
                            ) => self.cfg.backoff_max,
                            (None, _) => backoff(&self.cfg, failures),
                        }
                    }
                    Err(e) => {
                        failures = failures.saturating_add(1);
                        tracing::warn!(error = %e, "control plane connection failed");
                        backoff(&self.cfg, failures)
                    }
                },
            };
            tokio::select! {
                () = tokio::time::sleep(jitter(delay)) => {}
                _ = shutdown.changed() => return,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_doubles_to_the_cap_and_jitter_stays_in_range() {
        let cfg = TransportConfig::new(
            "wss://x",
            Arc::new(
                rustls::ClientConfig::builder_with_provider(Arc::new(
                    rustls::crypto::ring::default_provider(),
                ))
                .with_safe_default_protocol_versions()
                .unwrap()
                .with_root_certificates(rustls::RootCertStore::empty())
                .with_no_client_auth(),
            ),
        );
        assert_eq!(backoff(&cfg, 0), Duration::from_millis(500));
        assert_eq!(backoff(&cfg, 3), Duration::from_secs(4));
        assert_eq!(backoff(&cfg, 40), Duration::from_secs(30));
        for _ in 0..100 {
            let j = jitter(Duration::from_secs(10));
            assert!(j >= Duration::from_secs(5) && j <= Duration::from_secs(10));
        }
    }
}
