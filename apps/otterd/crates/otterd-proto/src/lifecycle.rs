//! Ownership protocol shapes shared by commands, reports and the journal
//! (MODEL §2, §3): slot grants, process observations, runtime submission
//! states, stop certificates, barrier evidence and leases.

use crate::ids::{
    AttemptId, BootId, ContainerRef, DataIdentity, EvidenceId, GrantId, HoldId, Incarnation,
    InstallId, MutationId, NodeId, Nonce, OpId, Sha256Hex, SlotRef,
};
use crate::num::{DurationMs, U53, UnixMs};
use crate::spec::{DisconnectAction, RestartPolicy};
use serde::{Deserialize, Serialize};

/// Read-only or read-write access to a data identity (MODEL §2.6).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DataAccess {
    Ro,
    Rw,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DataClaim {
    pub data_identity: DataIdentity,
    pub claim_epoch: U53,
    pub access: DataAccess,
}

/// Start authority for one slot generation on one node epoch and one node
/// process incarnation: a grant never survives a daemon restart (MODEL §2.4).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SlotGrant {
    pub grant_id: GrantId,
    pub slot: SlotRef,
    pub generation: U53,
    pub authority_term: U53,
    pub node_epoch: U53,
    pub incarnation: Incarnation,
    pub exclusive: bool,
    pub disconnect_action: DisconnectAction,
    /// Delegated local restart budget (MODEL §2.5).
    pub restart: RestartPolicy,
    pub data_claims: Vec<DataClaim>,
    /// New attempts stay probe-only until the CP admits them to a serving set.
    pub probe_only: bool,
}

/// CP grant states (MODEL §2.2).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GrantState {
    Prepared,
    Granted,
    Starting,
    Running,
    Stopping,
    Released,
    /// Issued with unknown side effects; keeps its ownership barrier.
    Unknown,
}

/// Runtime submission state of one Engine mutation (MODEL §2.2.1).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SubmissionState {
    NotSubmitted,
    Submitted,
    Settled,
    Retired,
}

/// Engine verbs otterd journals.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EngineVerb {
    Create,
    Start,
    Restart,
    Stop,
    Kill,
    Remove,
}

impl EngineVerb {
    /// Can this verb make a process run, now or later?
    #[must_use]
    pub fn can_start_process(self) -> bool {
        matches!(self, Self::Create | Self::Start | Self::Restart)
    }
}

/// Process observation of one container, independent of submission state.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ProcessObservation {
    Absent,
    Created,
    Running {
        pid: u32,
    },
    #[serde(rename_all = "camelCase")]
    Exited {
        exit_code: i64,
    },
    /// Docker unreachable, inspect hung, or the answer was not definitive.
    Unknown {
        reason: String,
    },
}

impl ProcessObservation {
    /// Positively not running (MODEL §2.3). `Unknown` is never stopped.
    #[must_use]
    pub fn is_positively_stopped(&self) -> bool {
        matches!(self, Self::Absent | Self::Created | Self::Exited { .. })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationReport {
    pub mutation_id: MutationId,
    pub verb: EngineVerb,
    pub state: SubmissionState,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptReport {
    pub attempt_id: AttemptId,
    /// Attempt number under this grant, from 1.
    pub ordinal: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub container: Option<ContainerRef>,
    pub process: ProcessObservation,
    pub mutations: Vec<MutationReport>,
}

/// Node-side view of one slot, as journalled.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotReport {
    pub slot: SlotRef,
    pub grant_id: GrantId,
    pub generation: U53,
    pub state: GrantState,
    /// Blocked by boot quarantine until a fresh grant for this incarnation.
    pub quarantined: bool,
    /// Start authority revoked (stop intent durable).
    pub revoked: bool,
    pub attempts: Vec<AttemptReport>,
    /// Holds that are Unknown keep the claim and block replacement.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unknown_holds: Vec<HoldId>,
}

/// Responsive-node positive stop certificate (MODEL §2.3 path 1), signed by
/// the node identity key under `otterd/stop-certificate/v1`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StopCertificate {
    pub install_id: InstallId,
    pub node_id: NodeId,
    pub node_epoch: U53,
    pub slot: SlotRef,
    pub grant_id: GrantId,
    pub op_id: OpId,
    pub attempt_ids: Vec<AttemptId>,
    /// Every container of those attempts and its final observation.
    pub containers: Vec<ContainerObservation>,
    pub cgroups_empty: bool,
    /// SHA-256 over every mutation of these attempts with its terminal state.
    pub mutation_inventory_digest: Sha256Hex,
    pub mutation_count: u32,
    pub boot_id: BootId,
    pub issued_at_unix_ms: UnixMs,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContainerObservation {
    pub container: ContainerRef,
    pub process: ProcessObservation,
}

/// How an external barrier retired every earlier Engine request on a node.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BarrierMethod {
    /// Provider hard power-off, action completion and off verified (MODEL §2.3 path 2).
    ProviderPowerOff,
    /// Operator-supplied out-of-band proof, recorded as a trust assertion (path 3).
    ManualFence,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BarrierEvidence {
    pub evidence_id: EvidenceId,
    pub method: BarrierMethod,
    /// Fence adapter that produced it (`hetzner`, `manual`, …).
    pub adapter: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_action_id: Option<String>,
    /// Who asserted a manual fence; required for `manual-fence`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asserted_by: Option<String>,
    pub node_epoch: U53,
    /// Boot of the node the barrier applies to, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub boot_id: Option<BootId>,
    pub observed_at_unix_ms: UnixMs,
}

/// Node → CP: renew the leases of `grants`. The node records `nonce` and its
/// `CLOCK_BOOTTIME` send instant before sending; duration counts from send.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaseRequest {
    pub nonce: Nonce,
    pub node_epoch: U53,
    pub boot_id: BootId,
    pub incarnation: Incarnation,
    pub grants: Vec<GrantId>,
}

/// CP → node, signed under `otterd/lease/v1`. Consumes the outstanding nonce once.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LeaseRenewal {
    pub install_id: InstallId,
    pub node_id: NodeId,
    pub node_epoch: U53,
    pub authority_term: U53,
    pub boot_id: BootId,
    pub incarnation: Incarnation,
    pub nonce: Nonce,
    /// Grants renewed; a grant whose revocation intent is committed is omitted.
    pub grants: Vec<GrantId>,
    /// Validity, counted by the node from the request's send instant.
    pub duration_ms: DurationMs,
}

/// Default lease renewal interval (MODEL §3).
pub const LEASE_RENEW_INTERVAL_MS: u64 = 5_000;
/// Default lease request validity L (MODEL §3).
pub const LEASE_DURATION_MS: u64 = 20_000;
