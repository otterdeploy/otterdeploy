//! Listing running containers through the Engine client.
//!
//! Only the list call is used: per-container figures come straight from the
//! container's cgroup (see `cgroup.rs`), which costs a few file reads instead
//! of one stats request per container per round, and keeps dockerd's own CPU
//! out of the collector's bill.

use http::StatusCode;
use otterd_engine::{DockerClient, TransportError};
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, thiserror::Error)]
pub enum DockerError {
    #[error(transparent)]
    Transport(#[from] TransportError),
    #[error("engine answered {status}: {message}")]
    Status { status: StatusCode, message: String },
    #[error("decode container list: {0}")]
    Decode(#[from] serde_json::Error),
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

/// Running containers (`GET /containers/json`).
pub(crate) async fn list_running(
    client: &DockerClient,
) -> Result<Vec<ListedContainer>, DockerError> {
    let response = client.get("/containers/json").await?;
    if !response.status.is_success() {
        return Err(DockerError::Status {
            status: response.status,
            message: response.message(),
        });
    }
    Ok(response.json()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

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
    async fn a_missing_socket_is_a_transport_error() {
        let c = DockerClient::new("/nonexistent/docker.sock", Duration::from_secs(1));
        assert!(matches!(
            list_running(&c).await,
            Err(DockerError::Transport(TransportError::Connect { .. }))
        ));
    }
}
