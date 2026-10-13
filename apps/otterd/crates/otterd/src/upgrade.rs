//! `node.upgrade`: fetch, verify and stage a signed release, then restart.
//!
//! The release must be signed by a pinned release key valid on the session's
//! bounded clock, speak the protocol this session negotiated (so the new
//! binary can reconnect), and read this node's journal. The binary for this
//! architecture is downloaded from `<base>/v<version>/otterd-linux-<arch>`,
//! capped at its signed size and checked against its signed SHA-256 before it
//! is staged in the inactive A/B slot. The daemon then exits so systemd starts
//! the staged slot behind the boot guard; the new binary commits the update
//! once healthy, or the guard rolls it back. A restart is a new incarnation:
//! tenant grants enter boot quarantine and the control plane re-issues them.

use crate::lifecycle::NodeError;
use otterd_proto::U53;
use otterd_proto::command::CommandResult;
use otterd_proto::envelope::SignedEnvelope;
use otterd_proto::release::ReleaseManifest;
use otterd_proto::version::JOURNAL_FORMAT;
use otterd_update::Layout;
use std::path::PathBuf;
use std::time::Duration;
use tokio::sync::Notify;

#[derive(Debug)]
pub struct Upgrader {
    pub layout: Layout,
    pub release_keys: PathBuf,
    /// For example `https://get.otterdeploy.com/otterd`.
    pub base_url: String,
    client: reqwest::Client,
    restart: Notify,
}

fn refused(e: impl std::fmt::Display) -> NodeError {
    NodeError::Refused(e.to_string())
}

/// `https://`, or plain HTTP to a loopback mirror.
fn allowed_base(url: &str) -> bool {
    url.starts_with("https://")
        || url.starts_with("http://127.0.0.1")
        || url.starts_with("http://localhost")
        || url.starts_with("http://[::1]")
}

impl Upgrader {
    pub fn new(layout: Layout, release_keys: PathBuf, base_url: &str) -> Result<Self, String> {
        if !allowed_base(base_url) {
            return Err(format!("release URL {base_url} must be https://"));
        }
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(300))
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self {
            layout,
            release_keys,
            base_url: base_url.trim_end_matches('/').to_owned(),
            client,
            restart: Notify::new(),
        })
    }

    /// Resolves once a staged release asks for the restart.
    pub async fn restart_requested(&self) {
        self.restart.notified().await;
    }

    /// Run `node.upgrade` for the release in `envelope`.
    pub async fn upgrade(
        &self,
        envelope: &SignedEnvelope,
        now: U53,
        session_protocol: u16,
    ) -> Result<CommandResult, NodeError> {
        let keys = otterd_update::keys::load(&self.release_keys).map_err(refused)?;
        let release: ReleaseManifest = otterd_update::keys::verify_release(&keys, envelope, now)
            .map_err(|e| NodeError::Unauthorized(e.to_string()))?;
        if !release.protocol.contains(session_protocol) {
            return Err(refused(format!(
                "release {} does not speak protocol {session_protocol}, which this session uses",
                release.version
            )));
        }
        let state = self.layout.state().map_err(refused)?;
        if state
            .slots
            .get(&state.active)
            .is_some_and(|s| s.version == release.version)
        {
            return Ok(CommandResult::Done);
        }
        let arch = std::env::consts::ARCH;
        let artifact = release
            .artifact(arch)
            .ok_or_else(|| refused(format!("release {} has no {arch} binary", release.version)))?;
        let url = format!("{}/v{}/otterd-linux-{arch}", self.base_url, release.version);
        let bytes = self.fetch(&url, artifact.size.get()).await?;
        let slot = self
            .layout
            .stage(&release, arch, &bytes, JOURNAL_FORMAT)
            .map_err(refused)?;
        tracing::warn!(version = %release.version, ?slot, "release staged; restarting into it");
        self.restart.notify_one();
        Ok(CommandResult::Document {
            schema: "otterd/upgrade-staged/v1".into(),
            body: serde_json::json!({"version": release.version, "slot": slot}),
        })
    }

    async fn fetch(&self, url: &str, size: u64) -> Result<Vec<u8>, NodeError> {
        let mut r = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| NodeError::Internal(format!("download {url}: {e}")))?;
        if !r.status().is_success() {
            return Err(refused(format!("download {url}: HTTP {}", r.status())));
        }
        let cap = usize::try_from(size).unwrap_or(usize::MAX);
        let mut out = Vec::with_capacity(cap.min(256 * 1024 * 1024));
        while let Some(chunk) = r
            .chunk()
            .await
            .map_err(|e| NodeError::Internal(format!("download {url}: {e}")))?
        {
            if out.len() + chunk.len() > cap {
                return Err(refused(format!("{url} is larger than the signed size")));
            }
            out.extend_from_slice(&chunk);
        }
        Ok(out)
    }
}
