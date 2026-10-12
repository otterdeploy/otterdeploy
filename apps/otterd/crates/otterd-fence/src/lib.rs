//! External fences: the evidence that lets the control plane replace an
//! exclusive workload on a node that cannot answer for itself.
//!
//! A fence is not a stop request. It produces evidence only when the node can
//! no longer run anything: a provider hard power-off that the provider confirmed
//! and that was observed off, or an operator's verified out-of-band proof. A
//! lease expiring, a missing heartbeat, a peer report, a revoked network key or
//! a sent SIGKILL is never fence evidence. Without evidence the caller keeps the
//! grant Unknown and the slot blocked.
//!
//! Provider adapters implement [`FenceAdapter`]; the first is [`HetznerFence`]
//! (Hetzner Cloud hard power-off), and another cloud API or IPMI/BMC plugs in
//! behind the same trait. [`ManualFence`] verifies an operator's out-of-band
//! proof for hosts without a fence API and records it as an explicit trust
//! assertion.

mod hetzner;
mod manual;

pub use hetzner::{ActionView, HetznerFence, ServerView};
pub use manual::{
    DEFAULT_MIN_SILENCE, DEFAULT_WINDOW, ManualFence, ManualProof, ProofMethod, Silence,
};

use otterd_proto::U53;
use otterd_proto::ids::{BootId, EvidenceId};
use otterd_proto::lifecycle::{BarrierEvidence, BarrierMethod};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::future::Future;
use std::time::Duration;

#[derive(Debug, thiserror::Error)]
pub enum FenceError {
    #[error("provider API unavailable: {0}")]
    Unavailable(String),
    #[error("provider refused: HTTP {status}: {body}")]
    Provider { status: u16, body: String },
    #[error("identity binding mismatch: {0}")]
    Binding(String),
    #[error("action {action_id} failed: {message}")]
    ActionFailed { action_id: String, message: String },
    #[error("not confirmed within {waited:?}: {what}")]
    Unconfirmed { what: String, waited: Duration },
    #[error("decode: {0}")]
    Decode(String),
    #[error("proof refused: {0}")]
    ProofRefused(String),
    #[error("this adapter cannot {0}")]
    Unsupported(&'static str),
}

/// Immutable binding of a node to a provider machine, recorded at enrollment.
/// A name or IP can be reused; the provider id plus creation time cannot.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineBinding {
    /// Adapter name (`hetzner`, `manual`, …).
    pub provider: String,
    pub server_id: String,
    /// Provider creation time (RFC 3339) recorded at enrollment.
    pub created_at: String,
    /// Labels that must still be present on the machine before any action.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub require_labels: BTreeMap<String, String>,
    /// The host's `/etc/machine-id`, for proofs that name it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub machine_id: Option<String>,
}

/// One status read and the local wall time it was observed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    pub at_unix_ms: U53,
    pub status: String,
}

/// The adapter's full record of a fence. [`FenceEvidence::barrier`] turns it
/// into the contract's [`BarrierEvidence`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FenceEvidence {
    pub evidence_id: EvidenceId,
    pub method: BarrierMethod,
    pub adapter: String,
    pub binding: MachineBinding,
    pub requested_at_unix_ms: U53,
    /// Provider action id (provider fence) or the operator's proof reference.
    pub reference: String,
    /// Who asserted it, for a manual fence.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asserted_by: Option<String>,
    pub observations: Vec<Observation>,
    pub verified_off_at_unix_ms: U53,
    /// Adapter-specific details (provider action, server view, proof text).
    pub detail: serde_json::Value,
}

impl FenceEvidence {
    /// The contract form the control plane records and the node accepts in
    /// `node.retireByBarrier`.
    #[must_use]
    pub fn barrier(&self, node_epoch: U53, boot_id: Option<BootId>) -> BarrierEvidence {
        BarrierEvidence {
            evidence_id: self.evidence_id.clone(),
            method: self.method,
            adapter: self.adapter.clone(),
            provider_action_id: (self.method == BarrierMethod::ProviderPowerOff)
                .then(|| self.reference.clone()),
            asserted_by: self.asserted_by.clone(),
            node_epoch,
            boot_id,
            observed_at_unix_ms: self.verified_off_at_unix_ms,
        }
    }
}

/// How a fenced machine is powered back on.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PowerOn {
    /// The installed OS boots; only safe after its authority was revoked.
    Normal,
    /// The provider's rescue system boots once, so the host's own OS and otterd
    /// do not run and an operator can revoke cached authority on its disk.
    #[serde(rename_all = "camelCase")]
    Rescue { ssh_key_id: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerOnRecord {
    pub binding: MachineBinding,
    pub mode: PowerOn,
    pub actions: Vec<ActionView>,
    pub running_at_unix_ms: U53,
}

/// A fence adapter. Every method checks the binding first.
pub trait FenceAdapter {
    fn name(&self) -> &str;

    /// Confirm the binding still names the same machine.
    fn check_binding(
        &self,
        binding: &MachineBinding,
    ) -> impl Future<Output = Result<(), FenceError>> + Send;

    /// Power the machine off hard and verify it, or fail with no evidence.
    fn fence(
        &self,
        binding: &MachineBinding,
    ) -> impl Future<Output = Result<FenceEvidence, FenceError>> + Send;

    /// Controlled power-on.
    fn power_on(
        &self,
        binding: &MachineBinding,
        mode: PowerOn,
    ) -> impl Future<Output = Result<PowerOnRecord, FenceError>> + Send;
}

/// Wall-clock milliseconds, for evidence.
pub(crate) fn now_ms() -> U53 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|d| u64::try_from(d.as_millis()).ok())
        .and_then(U53::new)
        .unwrap_or(U53::ZERO)
}

pub(crate) fn new_evidence_id(prefix: &str) -> Result<EvidenceId, FenceError> {
    let hex = otterd_proto::ids::random_hex::<16>()
        .map_err(|e| FenceError::Unavailable(format!("rng: {e}")))?;
    EvidenceId::new(format!("{prefix}_{hex}")).map_err(|e| FenceError::Decode(e.to_string()))
}
