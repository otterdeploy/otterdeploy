//! Ownership protocol shapes shared by commands, reports and the journal
//!: slot grants, process observations, runtime submission
//! states, stop certificates, barrier evidence and leases.

use crate::ids::{
    AttemptId, BootId, ContainerRef, DataIdentity, EvidenceId, GrantId, HoldId, Incarnation,
    InstallId, MutationId, NodeId, Nonce, OpId, ScopeId, Sha256Hex, SlotRef, VipId,
};
use crate::num::{DurationMs, U53, UnixMs};
use crate::spec::{DisconnectAction, RestartPolicy};
use serde::{Deserialize, Serialize};

/// Read-only or read-write access to a data identity.
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
/// process incarnation: a grant never survives a daemon restart.
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
    /// Delegated local restart budget.
    pub restart: RestartPolicy,
    pub data_claims: Vec<DataClaim>,
    /// New attempts stay probe-only until the CP admits them to a serving set.
    pub probe_only: bool,
    /// Adopt this attempt, held from an earlier node process, instead of
    /// starting a new one: the container keeps running under this grant.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adopts_attempt: Option<AttemptId>,
    /// Adopt this running container, started outside otterd (plain Docker),
    /// as the grant's only attempt instead of starting one. Full container id;
    /// the control plane already set its restart policy to `no`. Only for a
    /// slot that never had a grant on this node; the container is never
    /// restarted by otterd.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adopts_container: Option<ContainerRef>,
    /// Where the attempt lives on the network. Absent: no scope network
    /// (the Engine's default bridge), for workloads that need none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub network: Option<GrantNetwork>,
}

/// The attempt's place on the node network. Placement-specific, so it rides
/// on the grant, not the spec.
///
/// The control plane allocates every value here from the fleet address plan
/// (`otterd-net`'s `AddressPlan`, ported to the control plane with parity
/// vectors): the scope, this node's network for it (inside the node's slice),
/// the attempt address (never reused before the stop is acknowledged) and the
/// VIP (never reused). The node only applies them.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GrantNetwork {
    /// The environment's isolation scope.
    pub scope_id: ScopeId,
    /// This scope's network on this node, IPv4 CIDR (`/24`..`/27`).
    pub subnet: String,
    /// The attempt's IPv4 address inside `subnet`.
    pub address: String,
    /// The environment resolver's listener address: the container's only
    /// DNS server.
    pub resolver: String,
    /// The environment's DNS zone, e.g. `prod.otd.internal`; the search
    /// domain, under which `endpoint.aliases` resolve.
    pub zone: String,
    /// The service's stable address, when its endpoint mode is `vip`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vip: Option<GrantVip>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GrantVip {
    pub vip_id: VipId,
    pub address: String,
}

/// CP grant states.
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

/// Runtime submission state of one Engine mutation.
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
    /// Freeze a held container's processes after a daemon restart.
    Pause,
    /// Resume them once the control plane adopted the attempt.
    Unpause,
    /// Set an adopted container's restart policy back when the adoption is
    /// released.
    UpdateRestartPolicy,
}

impl EngineVerb {
    /// Can this verb make a process run, now or later?
    #[must_use]
    pub fn can_start_process(self) -> bool {
        // A restart policy other than `no` lets the Engine start it later.
        matches!(
            self,
            Self::Create | Self::Start | Self::Restart | Self::Unpause | Self::UpdateRestartPolicy
        )
    }
}

/// A Docker restart policy, as an adopted container had it before adoption.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "name", rename_all = "kebab-case", deny_unknown_fields)]
pub enum EngineRestartPolicy {
    No,
    Always,
    UnlessStopped,
    #[serde(rename_all = "camelCase")]
    OnFailure {
        maximum_retry_count: u32,
    },
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
    /// The process exists but is frozen (the Engine's pause). Never reported
    /// as running: a frozen workload serves nothing.
    Paused {
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
    /// Positively not running. `Unknown` is never stopped.
    #[must_use]
    pub fn is_positively_stopped(&self) -> bool {
        matches!(self, Self::Absent | Self::Created | Self::Exited { .. })
    }

    /// A process exists, running or frozen.
    #[must_use]
    pub fn is_live(&self) -> bool {
        matches!(self, Self::Running { .. } | Self::Paused { .. })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationReport {
    pub mutation_id: MutationId,
    pub verb: EngineVerb,
    pub state: SubmissionState,
}

/// Why an attempt ended before its process could run. Terminal: the node
/// never retries the attempt; the control plane applies its restart and
/// rollout policy (a new grant or attempt).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttemptFailure {
    /// Stable machine code, one of the `AttemptFailure::*` constants.
    pub code: String,
    /// What the node or the Engine said, for people.
    pub message: String,
}

impl AttemptFailure {
    /// The image was absent and could not be pulled (registry error, timeout,
    /// or a pulled image that does not match the pinned digest).
    pub const IMAGE_PULL_FAILED: &'static str = "image-pull-failed";
    /// The Engine definitively refused to create the container.
    pub const CREATE_REFUSED: &'static str = "create-refused";
    /// The container exists but the Engine definitively refused to start it.
    pub const START_REFUSED: &'static str = "start-refused";
    /// The node refused to go on after accepting the grant (a revoked grant,
    /// a mount it could not stage, a spec it cannot run).
    pub const REFUSED: &'static str = "refused";

    #[must_use]
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_owned(),
            message: message.into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptReport {
    pub attempt_id: AttemptId,
    /// Attempt number under this grant, from 1.
    pub ordinal: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub container: Option<ContainerRef>,
    /// What the Engine last said about the attempt's container. A reconcile
    /// pass observes every live attempt; a pass that cannot ask the Engine
    /// turns this `Unknown`, so `Running` here means the latest pass saw it
    /// running.
    pub process: ProcessObservation,
    /// Wall-clock time of the first observation that saw `process` as it is
    /// now; every observation since agreed. Absent when the value comes from
    /// the journal rather than the Engine.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observed_since_unix_ms: Option<UnixMs>,
    pub mutations: Vec<MutationReport>,
    /// Set when the attempt ended before a process ran. Its process is then
    /// `absent` (or `created`, when a start was refused) and stays so.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure: Option<AttemptFailure>,
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
    /// Held from an earlier node process: no new starts, waiting for the
    /// control plane to adopt it (a grant whose `adoptsAttempt` names this
    /// attempt) or to stop it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub held: Option<HeldAttempt>,
}

/// The attempt a held grant keeps, and whether its container is paused.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeldAttempt {
    pub attempt_id: AttemptId,
    pub paused: bool,
}

/// Responsive-node positive stop certificate, signed by
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
    /// Stopped but kept: an adopted container stays so a rollback can start
    /// it again; only `workload.remove` deletes it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub retained: bool,
}

/// How an external barrier retired every earlier Engine request on a node.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BarrierMethod {
    /// Provider hard power-off, action completion and off verified.
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

/// Default lease renewal interval.
pub const LEASE_RENEW_INTERVAL_MS: u64 = 5_000;
/// Default lease request validity L.
pub const LEASE_DURATION_MS: u64 = 20_000;
