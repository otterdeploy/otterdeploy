//! Listing running containers from the Docker Engine API over its unix socket.
//!
//! Only the list call is used: per-container figures come straight from the
//! container's cgroup (see `cgroup.rs`), which costs a few file reads instead
//! of one stats request per container per round, and keeps dockerd's own CPU
//! out of the collector's bill.

use bytes::Bytes;
use http::{Method, Request, StatusCode, header};
use http_body_util::{BodyExt, Empty, Limited};
use hyper_util::rt::TokioIo;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::net::UnixStream;

/// The list response for 1,000 containers is well under this.
const MAX_BODY: usize = 16 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum DockerError {
    #[error("connect {socket}: {source}")]
    Connect {
        socket: String,
        #[source]
        source: std::io::Error,
    },
    #[error("http: {0}")]
    Http(String),
    #[error("engine answered {status}")]
    Status { status: StatusCode },
    #[error("decode container list: {0}")]
    Decode(#[from] serde_json::Error),
    #[error("no answer within {0:?}")]
    Timeout(Duration),
}

/// One running container as the list call reports it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(crate) struct ListedContainer {
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) names: Vec<String>,
    #[serde(default)]
    pub(crate) labels: Option<HashMap<String, String>>,
    #[serde(default)]
    pub(crate) status: String,
}

impl ListedContainer {
    /// Docker prefixes names with `/`.
    pub(crate) fn name(&self) -> &str {
        self.names
            .first()
            .map_or(self.id.as_str(), |n| n.trim_start_matches('/'))
    }

    pub(crate) fn label(&self, key: &str) -> Option<&str> {
        self.labels.as_ref()?.get(key).map(String::as_str)
    }
}

#[derive(Debug, Clone)]
pub struct DockerClient {
    socket: PathBuf,
    timeout: Duration,
}

impl DockerClient {
    pub fn new(socket: impl Into<PathBuf>, timeout: Duration) -> Self {
        Self {
            socket: socket.into(),
            timeout,
        }
    }

    pub fn socket(&self) -> &Path {
        &self.socket
    }

    /// Running containers (`GET /containers/json`).
    ///
    /// # Errors
    /// The socket is unreachable, the engine errs or times out, or the body is
    /// not a container list.
    pub(crate) async fn list_running(&self) -> Result<Vec<ListedContainer>, DockerError> {
        let body = tokio::time::timeout(self.timeout, self.get("/containers/json"))
            .await
            .map_err(|_| DockerError::Timeout(self.timeout))??;
        Ok(serde_json::from_slice(&body)?)
    }

    async fn get(&self, path: &str) -> Result<Bytes, DockerError> {
        let stream =
            UnixStream::connect(&self.socket)
                .await
                .map_err(|source| DockerError::Connect {
                    socket: self.socket.display().to_string(),
                    source,
                })?;
        let (mut sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(stream))
            .await
            .map_err(|e| DockerError::Http(e.to_string()))?;
        // The connection future ends when the response is read or on error;
        // either way the request below reports what went wrong.
        let conn = tokio::spawn(conn);
        let request = Request::builder()
            .method(Method::GET)
            .uri(path)
            .header(header::HOST, "docker")
            .body(Empty::<Bytes>::new())
            .map_err(|e| DockerError::Http(e.to_string()))?;
        let response = sender
            .send_request(request)
            .await
            .map_err(|e| DockerError::Http(e.to_string()))?;
        let status = response.status();
        let body = Limited::new(response.into_body(), MAX_BODY)
            .collect()
            .await
            .map_err(|e| DockerError::Http(e.to_string()))?
            .to_bytes();
        conn.abort();
        if !status.is_success() {
            return Err(DockerError::Status { status });
        }
        Ok(body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_the_list_shape() {
        let body = r#"[{"Id":"abc","Names":["/web-1"],"Labels":{"otterdeploy.resource.id":"svc_1"},"State":"running","Status":"Up 3 minutes (healthy)","Image":"x"},
                      {"Id":"def","Names":[],"Labels":null,"State":"running","Status":"Up 1 second"}]"#;
        let list: Vec<ListedContainer> = serde_json::from_str(body).unwrap();
        assert_eq!(list[0].name(), "web-1");
        assert_eq!(list[0].label("otterdeploy.resource.id"), Some("svc_1"));
        assert_eq!(list[1].name(), "def");
        assert_eq!(list[1].label("x"), None);
    }

    #[tokio::test]
    async fn a_missing_socket_is_a_connect_error() {
        let c = DockerClient::new("/nonexistent/docker.sock", Duration::from_secs(1));
        assert!(matches!(
            c.list_running().await,
            Err(DockerError::Connect { .. })
        ));
    }
}
