//! Hetzner Cloud hard power-off.
//!
//! Evidence is produced only when all of these hold, in order:
//!
//! 1. the target is bound by its immutable server id **and** creation time,
//!    plus an optional label allowlist;
//! 2. the provider accepted a hard `poweroff` (not `shutdown`, an ACPI request
//!    the guest can ignore);
//! 3. that exact action reached `success` (an API timeout or `running` is not
//!    completion);
//! 4. the server then reports `off` on several consecutive reads, with its
//!    identity unchanged.
//!
//! The API answers `poweroff` as action `stop_server`. Measured on real servers:
//! about 7 s from request to action success, `off` on the first read after
//! that, about 5 s from power-on to `running`, about 45 s to a rescue shell.
//! The defaults below leave generous margins.

use crate::{
    FenceAdapter, FenceError, FenceEvidence, MachineBinding, Observation, PowerOn, PowerOnRecord,
    new_evidence_id, now_ms,
};
use otterd_proto::lifecycle::BarrierMethod;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::time::{Duration, Instant};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerView {
    pub id: u64,
    pub name: String,
    pub status: String,
    pub created: String,
    #[serde(default)]
    pub labels: BTreeMap<String, String>,
    #[serde(default)]
    pub rescue_enabled: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActionView {
    pub id: u64,
    pub command: String,
    pub status: String,
    #[serde(default)]
    pub progress: u32,
    #[serde(default)]
    pub started: Option<String>,
    #[serde(default)]
    pub finished: Option<String>,
    #[serde(default)]
    pub error: Option<serde_json::Value>,
}

#[derive(Clone, Debug)]
pub struct HetznerFence {
    http: reqwest::Client,
    base: String,
    token: String,
    pub action_timeout: Duration,
    pub off_timeout: Duration,
    pub off_confirmations: usize,
    pub poll_interval: Duration,
}

#[derive(Deserialize)]
struct ServerEnvelope {
    server: ServerView,
}

#[derive(Deserialize)]
struct ActionEnvelope {
    action: ActionView,
}

impl HetznerFence {
    /// `token` is the separately held fence credential, never the control
    /// plane's general provider token.
    pub fn new(token: String) -> Result<Self, FenceError> {
        Self::with_base("https://api.hetzner.cloud/v1".into(), token)
    }

    pub fn with_base(base: String, token: String) -> Result<Self, FenceError> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .https_only(base.starts_with("https://"))
            .build()
            .map_err(|e| FenceError::Unavailable(e.to_string()))?;
        Ok(Self {
            http,
            base,
            token,
            action_timeout: Duration::from_secs(180),
            off_timeout: Duration::from_secs(120),
            off_confirmations: 3,
            poll_interval: Duration::from_secs(1),
        })
    }

    async fn call<T: serde::de::DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<T, FenceError> {
        let mut req = self
            .http
            .request(method, format!("{}{path}", self.base))
            .bearer_auth(&self.token);
        if let Some(b) = body {
            req = req.json(&b);
        }
        let resp = req
            .send()
            .await
            .map_err(|e| FenceError::Unavailable(e.without_url().to_string()))?;
        let status = resp.status().as_u16();
        let text = resp
            .text()
            .await
            .map_err(|e| FenceError::Unavailable(e.without_url().to_string()))?;
        if !(200..300).contains(&status) {
            return Err(FenceError::Provider {
                status,
                body: text.chars().take(400).collect(),
            });
        }
        serde_json::from_str(&text).map_err(|e| FenceError::Decode(e.to_string()))
    }

    fn server_id(binding: &MachineBinding) -> Result<u64, FenceError> {
        binding.server_id.parse().map_err(|_| {
            FenceError::Binding(format!("server id {:?} is not numeric", binding.server_id))
        })
    }

    pub async fn server(&self, id: u64) -> Result<ServerView, FenceError> {
        let e: ServerEnvelope = self
            .call(reqwest::Method::GET, &format!("/servers/{id}"), None)
            .await?;
        Ok(e.server)
    }

    pub async fn action(&self, server: u64, action: u64) -> Result<ActionView, FenceError> {
        let e: ActionEnvelope = self
            .call(
                reqwest::Method::GET,
                &format!("/servers/{server}/actions/{action}"),
                None,
            )
            .await?;
        Ok(e.action)
    }

    /// The provider's view, after checking it is still the bound machine.
    pub async fn bound_server(&self, b: &MachineBinding) -> Result<ServerView, FenceError> {
        let s = self.server(Self::server_id(b)?).await?;
        if s.created != b.created_at {
            return Err(FenceError::Binding(format!(
                "server {} created {} != bound {}",
                b.server_id, s.created, b.created_at
            )));
        }
        for (k, v) in &b.require_labels {
            if s.labels.get(k) != Some(v) {
                return Err(FenceError::Binding(format!(
                    "server {} label {k}={:?}, required {v}",
                    b.server_id,
                    s.labels.get(k)
                )));
            }
        }
        Ok(s)
    }

    async fn post_action(
        &self,
        server: u64,
        verb: &str,
        body: Option<serde_json::Value>,
    ) -> Result<ActionView, FenceError> {
        let e: ActionEnvelope = self
            .call(
                reqwest::Method::POST,
                &format!("/servers/{server}/actions/{verb}"),
                Some(body.unwrap_or_else(|| serde_json::json!({}))),
            )
            .await?;
        Ok(e.action)
    }

    async fn await_action(&self, server: u64, mut a: ActionView) -> Result<ActionView, FenceError> {
        let start = Instant::now();
        loop {
            match a.status.as_str() {
                "success" => return Ok(a),
                "error" => {
                    return Err(FenceError::ActionFailed {
                        action_id: a.id.to_string(),
                        message: a.error.map(|e| e.to_string()).unwrap_or_default(),
                    });
                }
                _ => {}
            }
            if start.elapsed() > self.action_timeout {
                return Err(FenceError::Unconfirmed {
                    what: format!("action {} still {}", a.id, a.status),
                    waited: start.elapsed(),
                });
            }
            tokio::time::sleep(self.poll_interval / 2).await;
            a = self.action(server, a.id).await?;
        }
    }

    /// Leave rescue mode for the next boot (after revoking cached authority).
    pub async fn disable_rescue(&self, b: &MachineBinding) -> Result<ActionView, FenceError> {
        let s = self.bound_server(b).await?;
        let a = self.post_action(s.id, "disable_rescue", None).await?;
        self.await_action(s.id, a).await
    }

    /// Hardware reset (reboot out of rescue into the installed OS).
    pub async fn reset(&self, b: &MachineBinding) -> Result<ActionView, FenceError> {
        let s = self.bound_server(b).await?;
        let a = self.post_action(s.id, "reset", None).await?;
        self.await_action(s.id, a).await
    }
}

impl FenceAdapter for HetznerFence {
    fn name(&self) -> &'static str {
        "hetzner"
    }

    async fn check_binding(&self, binding: &MachineBinding) -> Result<(), FenceError> {
        self.bound_server(binding).await.map(|_| ())
    }

    async fn fence(&self, b: &MachineBinding) -> Result<FenceEvidence, FenceError> {
        let before = self.bound_server(b).await?;
        let requested_at = now_ms();
        let action = self.post_action(before.id, "poweroff", None).await?;
        let action = self.await_action(before.id, action).await?;
        let start = Instant::now();
        let mut observations = Vec::new();
        let mut consecutive = 0;
        while consecutive < self.off_confirmations {
            if start.elapsed() > self.off_timeout {
                return Err(FenceError::Unconfirmed {
                    what: format!(
                        "server {} never reported off: {observations:?}",
                        b.server_id
                    ),
                    waited: start.elapsed(),
                });
            }
            let s = self.server(before.id).await?;
            if s.created != b.created_at {
                return Err(FenceError::Binding(
                    "server identity changed during the fence".into(),
                ));
            }
            observations.push(Observation {
                at_unix_ms: now_ms(),
                status: s.status.clone(),
            });
            consecutive = if s.status == "off" {
                consecutive + 1
            } else {
                0
            };
            if consecutive < self.off_confirmations {
                tokio::time::sleep(self.poll_interval).await;
            }
        }
        Ok(FenceEvidence {
            evidence_id: new_evidence_id("fence")?,
            method: BarrierMethod::ProviderPowerOff,
            adapter: "hetzner".into(),
            binding: b.clone(),
            requested_at_unix_ms: requested_at,
            reference: action.id.to_string(),
            asserted_by: None,
            verified_off_at_unix_ms: observations.last().map_or_else(now_ms, |o| o.at_unix_ms),
            observations,
            detail: serde_json::json!({"serverBefore": before, "action": action}),
        })
    }

    async fn power_on(
        &self,
        b: &MachineBinding,
        mode: PowerOn,
    ) -> Result<PowerOnRecord, FenceError> {
        let s = self.bound_server(b).await?;
        let mut actions = Vec::new();
        if let PowerOn::Rescue { ssh_key_id } = &mode {
            let key: u64 = ssh_key_id.parse().map_err(|_| {
                FenceError::Binding(format!("ssh key id {ssh_key_id:?} is not numeric"))
            })?;
            let a = self
                .post_action(
                    s.id,
                    "enable_rescue",
                    Some(serde_json::json!({"type": "linux64", "ssh_keys": [key]})),
                )
                .await?;
            actions.push(self.await_action(s.id, a).await?);
        }
        let a = self.post_action(s.id, "poweron", None).await?;
        actions.push(self.await_action(s.id, a).await?);
        let start = Instant::now();
        loop {
            let now = self.server(s.id).await?;
            if now.status == "running" {
                return Ok(PowerOnRecord {
                    binding: b.clone(),
                    mode,
                    actions,
                    running_at_unix_ms: now_ms(),
                });
            }
            if start.elapsed() > self.off_timeout {
                return Err(FenceError::Unconfirmed {
                    what: format!("server {} status {}", b.server_id, now.status),
                    waited: start.elapsed(),
                });
            }
            tokio::time::sleep(self.poll_interval).await;
        }
    }
}
