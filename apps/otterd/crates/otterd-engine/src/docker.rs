//! A small Docker Engine API client over the unix socket.
//!
//! One connection per request, so a stuck request never blocks another. A
//! timeout or dropped connection is a transport error: it says nothing about
//! whether dockerd executed the request (MODEL §2.2.1). dockerd can hang on
//! inspect and `/version` while containerd is blocked, so callers treat
//! Engine reachability as a reconcile result, never a startup gate.

use bytes::Bytes;
use http::{Method, Request, StatusCode, header};
use http_body_util::{BodyExt as _, Full, Limited};
use hyper_util::rt::TokioIo;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::net::UnixStream;

/// Largest Engine response body read into memory.
pub const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum TransportError {
    #[error("connect {socket}: {source}")]
    Connect {
        socket: String,
        source: std::io::Error,
    },
    #[error("http: {0}")]
    Http(String),
    #[error("no response within {0:?}")]
    Timeout(Duration),
}

/// A complete Engine response.
#[derive(Debug, Clone)]
pub struct EngineResponse {
    pub status: StatusCode,
    pub body: Bytes,
}

impl EngineResponse {
    pub fn json<T: for<'de> Deserialize<'de>>(&self) -> Result<T, serde_json::Error> {
        serde_json::from_slice(&self.body)
    }

    /// Docker error bodies are `{"message": "..."}`; anything else is truncated text.
    #[must_use]
    pub fn message(&self) -> String {
        #[derive(Deserialize)]
        struct Msg {
            message: String,
        }
        serde_json::from_slice::<Msg>(&self.body).map_or_else(
            |_| {
                String::from_utf8_lossy(&self.body)
                    .chars()
                    .take(512)
                    .collect()
            },
            |m| m.message,
        )
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct VersionInfo {
    pub version: String,
    pub api_version: String,
    #[serde(default)]
    pub min_api_version: Option<String>,
}

#[derive(Debug, Clone)]
pub struct DockerClient {
    socket: PathBuf,
    api_prefix: String,
    timeout: Duration,
}

impl DockerClient {
    /// Unversioned until [`Self::negotiate`] pins the daemon's API version.
    pub fn new(socket: impl Into<PathBuf>, timeout: Duration) -> Self {
        Self {
            socket: socket.into(),
            api_prefix: String::new(),
            timeout,
        }
    }

    #[must_use]
    pub fn socket(&self) -> &Path {
        &self.socket
    }

    #[must_use]
    pub fn timeout(&self) -> Duration {
        self.timeout
    }

    #[must_use]
    pub fn is_negotiated(&self) -> bool {
        !self.api_prefix.is_empty()
    }

    /// The same client with a longer per-request budget (a stop legitimately
    /// takes its grace period before the Engine answers).
    #[must_use]
    pub fn with_timeout(&self, timeout: Duration) -> Self {
        Self {
            timeout,
            ..self.clone()
        }
    }

    /// `GET /version` (unversioned) and pin the API prefix. Re-run by the
    /// reconciler after a failure instead of keeping an unversioned client.
    pub async fn negotiate(&mut self) -> Result<VersionInfo, TransportError> {
        let resp = self.raw(Method::GET, "/version", None, None).await?;
        let v: VersionInfo = resp.json().map_err(|e| {
            TransportError::Http(format!("version decode: {e} ({})", resp.message()))
        })?;
        self.api_prefix = format!("/v{}", v.api_version);
        Ok(v)
    }

    pub async fn ping(&self) -> Result<(), TransportError> {
        let r = self.raw(Method::GET, "/_ping", None, None).await?;
        if r.status.is_success() {
            Ok(())
        } else {
            Err(TransportError::Http(format!("ping {}", r.status)))
        }
    }

    pub async fn get(&self, path: &str) -> Result<EngineResponse, TransportError> {
        self.call(Method::GET, path, None).await
    }

    /// Send exact body bytes (the bytes whose hash was journalled).
    pub async fn send(
        &self,
        method: Method,
        path: &str,
        body: Option<Bytes>,
    ) -> Result<EngineResponse, TransportError> {
        self.call(method, path, body).await
    }

    /// `POST /images/load` with a tar archive body.
    pub async fn load_image(&self, archive: Bytes) -> Result<EngineResponse, TransportError> {
        let path = format!("{}/images/load?quiet=1", self.api_prefix);
        self.raw(
            Method::POST,
            &path,
            Some(archive),
            Some("application/x-tar"),
        )
        .await
    }

    async fn call(
        &self,
        method: Method,
        path: &str,
        body: Option<Bytes>,
    ) -> Result<EngineResponse, TransportError> {
        let path = format!("{}{path}", self.api_prefix);
        self.raw(method, &path, body, Some("application/json"))
            .await
    }

    async fn raw(
        &self,
        method: Method,
        path: &str,
        body: Option<Bytes>,
        content_type: Option<&str>,
    ) -> Result<EngineResponse, TransportError> {
        let request = async {
            let stream = UnixStream::connect(&self.socket).await.map_err(|source| {
                TransportError::Connect {
                    socket: self.socket.display().to_string(),
                    source,
                }
            })?;
            let (mut sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(stream))
                .await
                .map_err(|e| TransportError::Http(e.to_string()))?;
            // The connection task ends with the request; its error is the request's error.
            tokio::spawn(async move {
                if let Err(e) = conn.await {
                    tracing::debug!(error = %e, "engine connection closed");
                }
            });
            let mut req = Request::builder()
                .method(method)
                .uri(path)
                .header(header::HOST, "docker");
            if let Some(ct) = content_type {
                req = req.header(header::CONTENT_TYPE, ct);
            }
            let req = req
                .body(Full::new(body.unwrap_or_default()))
                .map_err(|e| TransportError::Http(e.to_string()))?;
            let resp = sender
                .send_request(req)
                .await
                .map_err(|e| TransportError::Http(e.to_string()))?;
            let status = resp.status();
            let body = Limited::new(resp.into_body(), MAX_RESPONSE_BYTES)
                .collect()
                .await
                .map_err(|e| TransportError::Http(e.to_string()))?
                .to_bytes();
            Ok(EngineResponse { status, body })
        };
        tokio::time::timeout(self.timeout, request)
            .await
            .map_err(|_| TransportError::Timeout(self.timeout))?
    }
}

/// Percent-encode a query value.
#[must_use]
pub fn urlencode(s: &str) -> String {
    use std::fmt::Write as _;
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(char::from(b));
            }
            _ => {
                let _ = write!(out, "%{b:02X}");
            }
        }
    }
    out
}
