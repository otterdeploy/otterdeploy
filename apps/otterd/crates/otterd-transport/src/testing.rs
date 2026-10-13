//! An in-process control plane over real TLS, for tests.
//!
//! It accepts `wss://localhost:<port>/…` with a freshly generated certificate,
//! runs the control-plane side of the handshake with a given signing key, and
//! hands each established session to the test.

use crate::tls::Trust;
use ed25519_dalek::SigningKey;
use futures_util::{SinkExt as _, StreamExt as _};
use otterd_proto::U53;
use otterd_proto::channel::{
    ChannelKind, ChannelLimits, ControlFrame, Hello, Reject, SessionProof, SessionRole, Welcome,
};
use otterd_proto::envelope::{PublicKey, SignContext, SignedEnvelope};
use otterd_proto::ids::{Nonce, SessionId};
use otterd_proto::version::Feature;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_rustls::TlsAcceptor;
use tokio_rustls::server::TlsStream;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;

/// What the fake control plane does with the next connections.
#[derive(Debug, Clone)]
pub struct Behavior {
    /// Answer `hello` with this instead of `welcome`.
    pub reject: Option<Reject>,
    /// Sign the hub proof with this key instead of the control-plane key.
    pub proof_key: Option<SigningKey>,
    pub limits: ChannelLimits,
    pub features: Vec<Feature>,
    pub authority_term: U53,
    /// Answer `ping` with `pong`.
    pub answer_pings: bool,
    /// Shift the reported wall clock.
    pub clock_offset_ms: i64,
}

impl Default for Behavior {
    fn default() -> Self {
        Self {
            reject: None,
            proof_key: None,
            limits: ChannelLimits::DEFAULT,
            features: vec![],
            authority_term: U53::ONE,
            answer_pings: true,
            clock_offset_ms: 0,
        }
    }
}

fn cp_now(offset: i64) -> U53 {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX));
    U53::new(u64::try_from(ms.saturating_add(offset)).unwrap_or(0)).unwrap_or(U53::ZERO)
}

/// One established session, from the control plane's side.
#[derive(Debug)]
pub struct CpSession {
    pub hello: Hello,
    pub session_id: SessionId,
    ws: WebSocketStream<TlsStream<TcpStream>>,
    behavior: Behavior,
}

impl CpSession {
    pub async fn send(&mut self, frame: &ControlFrame) {
        let text = serde_json::to_string(frame).unwrap_or_default();
        let _ = self.ws.send(Message::text(text)).await;
    }

    pub async fn send_raw(&mut self, text: String) {
        let _ = self.ws.send(Message::text(text)).await;
    }

    /// The next frame other than `ping` (answered when configured), or `None`
    /// once the node closed the connection.
    pub async fn recv(&mut self) -> Option<ControlFrame> {
        loop {
            match self.ws.next().await? {
                Ok(Message::Text(t)) => {
                    let frame: ControlFrame = serde_json::from_str(t.as_str()).ok()?;
                    if let ControlFrame::Ping { seq, node_mono_ms } = frame {
                        if self.behavior.answer_pings {
                            let pong = ControlFrame::Pong {
                                seq,
                                node_mono_ms,
                                cp_unix_ms: cp_now(self.behavior.clock_offset_ms),
                            };
                            self.send(&pong).await;
                        }
                        continue;
                    }
                    return Some(frame);
                }
                Ok(Message::Close(_)) | Err(_) => return None,
                Ok(_) => {}
            }
        }
    }

    /// `recv` with a deadline.
    pub async fn recv_within(&mut self, d: Duration) -> Option<ControlFrame> {
        tokio::time::timeout(d, self.recv()).await.ok().flatten()
    }

    pub async fn close(mut self) {
        let _ = self.ws.close(None).await;
    }
}

#[derive(Debug)]
pub struct FakeCp {
    pub url: String,
    /// A PEM file holding the fake's certificate, for [`Trust::Only`].
    pub trust: Trust,
    pub behavior: Arc<Mutex<Behavior>>,
    /// Connections accepted at the TCP level.
    pub attempts: Arc<AtomicU32>,
    sessions: mpsc::UnboundedReceiver<CpSession>,
    _dir: tempfile_dir::Dir,
}

mod tempfile_dir {
    /// A directory removed on drop.
    #[derive(Debug)]
    pub(super) struct Dir(pub(super) std::path::PathBuf);
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}

impl FakeCp {
    /// Listen on localhost. `cp_key` signs hub proofs; `node_key` is the
    /// enrolled node identity key that must sign `authenticate`.
    pub async fn start(cp_key: SigningKey, node_key: PublicKey) -> std::io::Result<Self> {
        let cert = rcgen::generate_simple_self_signed(vec!["localhost".to_owned()])
            .map_err(std::io::Error::other)?;
        let dir = std::env::temp_dir().join(format!(
            "otterd-fake-cp-{}",
            otterd_proto::ids::random_hex::<8>().map_err(std::io::Error::other)?
        ));
        std::fs::create_dir_all(&dir)?;
        let pem = dir.join("ca.pem");
        std::fs::write(&pem, cert.cert.pem())?;
        let server = rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .map_err(std::io::Error::other)?
        .with_no_client_auth()
        .with_single_cert(
            vec![cert.cert.der().clone()],
            rustls::pki_types::PrivateKeyDer::Pkcs8(cert.signing_key.serialize_der().into()),
        )
        .map_err(std::io::Error::other)?;
        let acceptor = TlsAcceptor::from(Arc::new(server));
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        let behavior = Arc::new(Mutex::new(Behavior::default()));
        let attempts = Arc::new(AtomicU32::new(0));
        let (tx, sessions) = mpsc::unbounded_channel();
        let (b, a) = (Arc::clone(&behavior), Arc::clone(&attempts));
        tokio::spawn(async move {
            while let Ok((tcp, _)) = listener.accept().await {
                a.fetch_add(1, Ordering::SeqCst);
                let (acceptor, b, tx, cp_key, node_key) = (
                    acceptor.clone(),
                    Arc::clone(&b),
                    tx.clone(),
                    cp_key.clone(),
                    node_key.clone(),
                );
                tokio::spawn(async move {
                    let behavior = b.lock().map(|g| g.clone()).unwrap_or_default();
                    if let Some(s) = handshake(acceptor, tcp, behavior, &cp_key, &node_key).await {
                        let _ = tx.send(s);
                    }
                });
            }
        });
        Ok(Self {
            url: format!("wss://localhost:{port}/api/otterd/connect"),
            trust: Trust::Only(pem),
            behavior,
            attempts,
            sessions,
            _dir: tempfile_dir::Dir(dir),
        })
    }

    pub fn set(&self, f: impl FnOnce(&mut Behavior)) {
        if let Ok(mut g) = self.behavior.lock() {
            f(&mut g);
        }
    }

    /// The next established session, or `None` after `within`.
    pub async fn session(&mut self, within: Duration) -> Option<CpSession> {
        tokio::time::timeout(within, self.sessions.recv())
            .await
            .ok()
            .flatten()
    }
}

async fn next_frame(ws: &mut WebSocketStream<TlsStream<TcpStream>>) -> Option<ControlFrame> {
    loop {
        match ws.next().await? {
            Ok(Message::Text(t)) => return serde_json::from_str(t.as_str()).ok(),
            Ok(Message::Close(_)) | Err(_) => return None,
            Ok(_) => {}
        }
    }
}

async fn send_frame(ws: &mut WebSocketStream<TlsStream<TcpStream>>, frame: &ControlFrame) {
    let text = serde_json::to_string(frame).unwrap_or_default();
    let _ = ws.send(Message::text(text)).await;
}

async fn handshake(
    acceptor: TlsAcceptor,
    tcp: TcpStream,
    behavior: Behavior,
    cp_key: &SigningKey,
    node_key: &PublicKey,
) -> Option<CpSession> {
    let tls = acceptor.accept(tcp).await.ok()?;
    let mut ws = tokio_tungstenite::accept_async(tls).await.ok()?;
    let ControlFrame::Hello(hello) = next_frame(&mut ws).await? else {
        return None;
    };
    if let Some(r) = behavior.reject.clone() {
        send_frame(&mut ws, &ControlFrame::Reject(r)).await;
        let _ = ws.close(None).await;
        return None;
    }
    let session_id: SessionId = format!("sess-{}", otterd_proto::ids::random_hex::<6>().ok()?)
        .parse()
        .ok()?;
    let mut welcome = Welcome {
        protocol: hello.protocol.max,
        session_id: session_id.clone(),
        cp_nonce: Nonce::random().ok()?,
        authority_term: behavior.authority_term,
        cp_unix_ms: cp_now(behavior.clock_offset_ms),
        limits: behavior.limits,
        features: otterd_proto::version::common_features(&hello.features, &behavior.features),
        hub_proof: SignedEnvelope::sign_bytes(cp_key, SignContext::Session, b"{}"),
    };
    let proof = |role| SessionProof {
        role,
        channel: ChannelKind::Control,
        protocol: welcome.protocol,
        install_id: hello.install_id.clone(),
        session_id: session_id.clone(),
        node_id: hello.node_id.clone(),
        node_epoch: hello.node_epoch,
        boot_id: hello.boot_id.clone(),
        incarnation: hello.incarnation.clone(),
        node_nonce: hello.node_nonce.clone(),
        cp_nonce: welcome.cp_nonce.clone(),
    };
    let hub = proof(SessionRole::Hub);
    let node_expected = proof(SessionRole::Node);
    welcome.hub_proof = SignedEnvelope::sign(
        behavior.proof_key.as_ref().unwrap_or(cp_key),
        SignContext::Session,
        &hub,
    )
    .ok()?;
    send_frame(&mut ws, &ControlFrame::Welcome(Box::new(welcome))).await;
    let ControlFrame::Authenticate {
        session_id: claimed,
        node_proof,
    } = next_frame(&mut ws).await?
    else {
        return None;
    };
    let got: SessionProof = node_proof
        .verify(std::slice::from_ref(node_key), SignContext::Session)
        .ok()?;
    if got != node_expected || claimed != session_id {
        let _ = ws.close(None).await;
        return None;
    }
    send_frame(
        &mut ws,
        &ControlFrame::Ready {
            session_id: session_id.clone(),
        },
    )
    .await;
    Some(CpSession {
        hello: *hello,
        session_id,
        ws,
        behavior,
    })
}
