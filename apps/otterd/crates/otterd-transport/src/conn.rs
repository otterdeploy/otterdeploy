//! One control session: connect and handshake, then serve until it ends.

use crate::TransportError;
use crate::clock::SessionClock;
use crate::credit::{TelemetryCredit, batch_items};
use crate::handshake::{HandshakeError, NodeIdentity};
use crate::manager::{Handler, Outgoing, RequestAnswer, SessionInfo, TransportConfig};
use futures_util::{SinkExt as _, StreamExt as _};
use otterd_proto::U53;
use otterd_proto::channel::{ChannelKind, ControlFrame, RequestRefusal};
use otterd_proto::ids::Nonce;
use otterd_proto::metrics::SampleBatch;
use otterd_sys::host::boottime;
use std::collections::HashSet;
use std::fmt;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::{Connector, MaybeTlsStream, WebSocketStream};

pub(crate) type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// Frame size accepted before `welcome` announces the real limit.
const HANDSHAKE_MAX_BYTES: usize = 64 * 1024;
/// The WebSocket layer's own ceiling; the announced limit is enforced per frame.
const SOCKET_MAX_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug)]
pub(crate) enum Ended {
    Shutdown,
    Reconnect,
    GoAway { after: Option<Duration> },
    Closed(String),
    PongTimeout,
    Protocol(String),
}

impl fmt::Display for Ended {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Shutdown => write!(f, "shutdown"),
            Self::Reconnect => write!(f, "reconnecting with a new identity"),
            Self::GoAway { after } => write!(f, "goAway (reconnect after {after:?})"),
            Self::Closed(why) => write!(f, "closed: {why}"),
            Self::PongTimeout => write!(f, "no pong within the timeout"),
            Self::Protocol(why) => write!(f, "protocol violation: {why}"),
        }
    }
}

fn ms(d: Duration) -> u64 {
    u64::try_from(d.as_millis()).unwrap_or(u64::MAX)
}

fn wall_unix_ms() -> U53 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|d| U53::new(ms(d)))
        .unwrap_or(U53::ZERO)
}

async fn send(ws: &mut Ws, frame: &ControlFrame) -> Result<(), TransportError> {
    let text = serde_json::to_string(frame).map_err(|e| TransportError::Protocol(e.to_string()))?;
    ws.send(Message::text(text)).await?;
    Ok(())
}

async fn recv(ws: &mut Ws, max: usize) -> Result<ControlFrame, TransportError> {
    loop {
        match ws.next().await {
            Some(Err(e)) => return Err(e.into()),
            Some(Ok(Message::Text(t))) => {
                if t.len() > max {
                    return Err(TransportError::Protocol(format!(
                        "{} byte frame exceeds {max}",
                        t.len()
                    )));
                }
                return serde_json::from_str(t.as_str())
                    .map_err(|e| TransportError::Protocol(e.to_string()));
            }
            None | Some(Ok(Message::Close(_))) => {
                return Err(TransportError::Protocol(
                    "closed during the handshake".into(),
                ));
            }
            Some(Ok(Message::Binary(_))) => {
                return Err(TransportError::Protocol(
                    "binary frame on the control channel".into(),
                ));
            }
            Some(Ok(_)) => {}
        }
    }
}

async fn timed<T>(
    limit: Duration,
    what: &'static str,
    f: impl Future<Output = Result<T, TransportError>>,
) -> Result<T, TransportError> {
    tokio::time::timeout(limit, f)
        .await
        .map_err(|_| TransportError::Timeout(what))?
}

/// Dial, then `hello` → `welcome` → `authenticate` → `ready`.
pub(crate) async fn connect(
    cfg: &TransportConfig,
    id: &NodeIdentity,
) -> Result<(Ws, SessionInfo), TransportError> {
    if !cfg.url.starts_with("wss://") {
        return Err(TransportError::InsecureUrl(cfg.url.clone()));
    }
    let ws_cfg = WebSocketConfig::default()
        .max_message_size(Some(SOCKET_MAX_BYTES))
        .max_frame_size(Some(SOCKET_MAX_BYTES));
    let (mut ws, _) = timed(cfg.connect_timeout, "connecting", async {
        Ok(Box::pin(tokio_tungstenite::connect_async_tls_with_config(
            cfg.url.as_str(),
            Some(ws_cfg),
            false,
            Some(Connector::Rustls(Arc::clone(&cfg.tls))),
        ))
        .await?)
    })
    .await?;
    let nonce = Nonce::random().map_err(|e| TransportError::Identity(e.to_string()))?;
    let sent = boottime();
    send(
        &mut ws,
        &ControlFrame::Hello(Box::new(id.hello(ChannelKind::Control, nonce.clone()))),
    )
    .await?;
    let first = timed(
        cfg.handshake_timeout,
        "waiting for welcome",
        recv(&mut ws, HANDSHAKE_MAX_BYTES),
    )
    .await?;
    let received = boottime();
    let welcome = match first {
        ControlFrame::Welcome(w) => *w,
        ControlFrame::Reject(r) => return Err(HandshakeError::Rejected(r).into()),
        other => {
            return Err(HandshakeError::Unexpected {
                expected: "welcome",
                got: other.kind(),
            }
            .into());
        }
    };
    // A control-plane key must be valid at the later of the two clocks, so a
    // stale timestamp cannot revive a key past its overlap window.
    let at = welcome.cp_unix_ms.max(wall_unix_ms());
    id.verify_welcome(ChannelKind::Control, &nonce, &welcome, at)?;
    let node_proof = id
        .node_proof(ChannelKind::Control, &welcome, &nonce)
        .map_err(|e| TransportError::Identity(e.to_string()))?;
    send(
        &mut ws,
        &ControlFrame::Authenticate {
            session_id: welcome.session_id.clone(),
            node_proof,
        },
    )
    .await?;
    match timed(
        cfg.handshake_timeout,
        "waiting for ready",
        recv(&mut ws, HANDSHAKE_MAX_BYTES),
    )
    .await?
    {
        ControlFrame::Ready { session_id } if session_id == welcome.session_id => {}
        ControlFrame::Ready { .. } => {
            return Err(TransportError::Protocol("ready for another session".into()));
        }
        ControlFrame::Reject(r) => return Err(HandshakeError::Rejected(r).into()),
        other => {
            return Err(HandshakeError::Unexpected {
                expected: "ready",
                got: other.kind(),
            }
            .into());
        }
    }
    let session = SessionInfo {
        session_id: welcome.session_id,
        protocol: welcome.protocol,
        authority_term: welcome.authority_term,
        limits: welcome.limits,
        features: welcome.features,
        clock: SessionClock::from_round_trip(sent, received, welcome.cp_unix_ms, cfg.clock_max_age),
    };
    Ok((ws, session))
}

struct Writer {
    sink: futures_util::stream::SplitSink<Ws, Message>,
    max: usize,
}

impl Writer {
    async fn write(&mut self, frame: &ControlFrame) -> Result<(), Ended> {
        let text = serde_json::to_string(frame).map_err(|e| Ended::Protocol(e.to_string()))?;
        if text.len() > self.max {
            // Never split or truncate; the control plane recovers the outcome
            // with `op.status`.
            tracing::error!(
                kind = frame.kind(),
                bytes = text.len(),
                max = self.max,
                "outbound frame exceeds the announced limit; not sent"
            );
            return Ok(());
        }
        self.sink
            .send(Message::text(text))
            .await
            .map_err(|e| Ended::Closed(e.to_string()))
    }
}

fn answer_frame(id: u32, answer: RequestAnswer) -> ControlFrame {
    match answer {
        RequestAnswer::Outcome {
            op_id,
            duplicate,
            outcome,
        } => ControlFrame::Response {
            id,
            op_id,
            duplicate,
            outcome,
        },
        RequestAnswer::Refused(error) => ControlFrame::RequestRefused { id, error },
    }
}

/// Serve an established session until it ends.
#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
pub(crate) async fn serve<H: Handler>(
    ws: Ws,
    mut session: SessionInfo,
    handler: &Arc<H>,
    cfg: &TransportConfig,
    mut control_rx: mpsc::UnboundedReceiver<Outgoing>,
    mut telemetry_rx: mpsc::Receiver<SampleBatch>,
    published: &watch::Sender<Option<SessionInfo>>,
    shutdown: &mut watch::Receiver<bool>,
    still_current: impl Fn() -> bool,
) -> Ended {
    let limits = session.limits;
    let max = usize::try_from(limits.max_frame_bytes).unwrap_or(usize::MAX);
    let (sink, mut stream) = ws.split();
    let mut out = Writer { sink, max };
    let mut credit = TelemetryCredit::new(limits.telemetry_credit);
    let mut waiting: Option<SampleBatch> = None;
    let mut active: HashSet<u32> = HashSet::new();
    let (done_tx, mut done_rx) = mpsc::unbounded_channel::<(u32, ControlFrame)>();
    let mut ping = tokio::time::interval(cfg.ping_interval);
    ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut ping_seq: u32 = 0;
    let mut outstanding: Option<(u32, Duration)> = None;

    for f in handler.on_ready(session.clone()).await {
        if let Err(e) = out.write(&f).await {
            return e;
        }
    }
    loop {
        let step: Result<(), Ended> = tokio::select! {
            biased;
            _ = shutdown.changed() => {
                let _ = out.sink.send(Message::Close(None)).await;
                return Ended::Shutdown;
            }
            Some((id, frame)) = done_rx.recv() => {
                active.remove(&id);
                match out.write(&frame).await {
                    // The request changed what the handshake bound (a
                    // re-enrollment): answer it, then connect again so the
                    // next session carries the new identity.
                    Ok(()) if !still_current() => {
                        tracing::info!("node identity changed; reconnecting");
                        let _ = out.sink.send(Message::Close(None)).await;
                        Err(Ended::Reconnect)
                    }
                    other => other,
                }
            }
            Some(queued) = control_rx.recv() => match queued {
                Outgoing::Frame(frame) => out.write(&frame).await,
                Outgoing::Reconnect => {
                    let _ = out.sink.send(Message::Close(None)).await;
                    Err(Ended::Reconnect)
                }
            },
            msg = stream.next() => match msg {
                None => Err(Ended::Closed("connection closed".into())),
                Some(Err(e)) => Err(Ended::Closed(e.to_string())),
                Some(Ok(Message::Text(t))) if t.len() > max => Err(Ended::Protocol(format!(
                    "{} byte frame exceeds the announced {max}", t.len()))),
                Some(Ok(Message::Text(t))) => match serde_json::from_str::<ControlFrame>(t.as_str()) {
                    // A newer control plane may send frames this node does not know.
                    Err(e) => {
                        tracing::debug!(error = %e, "ignoring an unrecognised control frame");
                        Ok(())
                    }
                    Ok(ControlFrame::Request { id, capability, payload }) => {
                        if active.contains(&id) {
                            out.write(&ControlFrame::RequestRefused { id, error: RequestRefusal::DuplicateId }).await
                        } else if active.len() >= usize::from(limits.max_active_commands) {
                            out.write(&ControlFrame::RequestRefused { id, error: RequestRefusal::Busy }).await
                        } else {
                            active.insert(id);
                            let h = Arc::clone(handler);
                            let s = session.clone();
                            let tx = done_tx.clone();
                            tokio::spawn(async move {
                                let answer = h.request(s, capability, payload).await;
                                let _ = tx.send((id, answer_frame(id, answer)));
                            });
                            Ok(())
                        }
                    }
                    Ok(ControlFrame::Pong { seq, cp_unix_ms, .. }) => {
                        if let Some((want, sent)) = outstanding && want == seq {
                            outstanding = None;
                            let now = boottime();
                            let reading = SessionClock::from_round_trip(sent, now, cp_unix_ms, cfg.clock_max_age);
                            session.clock = session.clock.refine(reading, now);
                            published.send_replace(Some(session.clone()));
                        }
                        Ok(())
                    }
                    Ok(ControlFrame::GoAway { reconnect_after_ms, code, message }) => {
                        tracing::warn!(?code, %message, "control plane sent goAway");
                        Err(Ended::GoAway { after: reconnect_after_ms.map(|ms| Duration::from_millis(ms.get())) })
                    }
                    Ok(f @ (ControlFrame::Hello(_) | ControlFrame::Welcome(_) | ControlFrame::Authenticate { .. }
                        | ControlFrame::Ready { .. } | ControlFrame::Reject(_))) => {
                        Err(Ended::Protocol(format!("{} after ready", f.kind())))
                    }
                    Ok(frame) => {
                        if let ControlFrame::TelemetryAck { credit: c, .. } = &frame {
                            credit.grant(*c);
                        }
                        let mut r = Ok(());
                        for reply in handler.frame(session.clone(), frame).await {
                            r = out.write(&reply).await;
                            if r.is_err() { break; }
                        }
                        r
                    }
                },
                Some(Ok(Message::Binary(_))) => Err(Ended::Protocol("binary frame on the control channel".into())),
                Some(Ok(Message::Close(_))) => Err(Ended::Closed("close frame".into())),
                Some(Ok(_)) => Ok(()),
            },
            _ = ping.tick() => {
                let now = boottime();
                match outstanding {
                    Some((_, sent)) if now.saturating_sub(sent) > cfg.pong_timeout => Err(Ended::PongTimeout),
                    Some(_) => Ok(()),
                    None => {
                        ping_seq = ping_seq.wrapping_add(1);
                        outstanding = Some((ping_seq, now));
                        out.write(&ControlFrame::Ping {
                            seq: ping_seq,
                            node_mono_ms: U53::new(ms(now)).unwrap_or(U53::MAX),
                        }).await
                    }
                }
            }
            Some(batch) = telemetry_rx.recv(), if waiting.is_none() => {
                waiting = Some(batch);
                Ok(())
            }
        };
        if let Err(ended) = step {
            return ended;
        }
        if let Some(batch) = waiting.take() {
            let items = batch_items(&batch);
            if credit.try_take(items) {
                if let Err(e) = out.write(&ControlFrame::Telemetry(batch)).await {
                    return e;
                }
            } else if items > limits.telemetry_credit {
                tracing::error!(
                    items,
                    window = limits.telemetry_credit,
                    "telemetry batch larger than the whole credit window; dropped"
                );
            } else {
                waiting = Some(batch);
            }
        }
    }
}
