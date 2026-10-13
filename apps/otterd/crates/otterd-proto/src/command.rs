//! Command payloads, results and operation outcomes.
//!
//! A request carries a [`Command`] as exact JSON bytes; the capability binds
//! their SHA-256. The command's `verb` must equal the capability's verb.
//!
//! Argument schemas fall in two groups. **Frozen**: the lifecycle verbs, `op.*`,
//! `node.*`, `metrics.sample`, `health.configure` and the stream binding; the
//! daemon core implements them and every other component builds against them.
//! **Provisional**: storage, backup, firewall, proxy and platform-update arguments
//! are owned by the storage, network, edge and platform-update work and may still change before the
//! release; changing one needs a contract PR touching both mirrors.

use crate::capability::{CapabilityError, Verb};
use crate::envelope::SignedEnvelope;
use crate::health::HealthCheck;
use crate::ids::{
    AttemptId, ContainerRef, DataIdentity, GrantId, OpId, ResourceId, RunId, ScopeId, Sha256Hex,
};
use crate::lifecycle::{BarrierEvidence, EngineRestartPolicy, SlotGrant, SlotReport};
use crate::num::{DurationMs, U53, UnixMs};
use crate::spec::{EnvVar, ServiceSpec};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Direction of a bulk stream, from the node's point of view.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StreamDirection {
    /// Node → CP (logs, exports, events).
    Out,
    /// CP → node (imports, uploads).
    In,
    /// Both (exec, PTY, db.connect).
    Duplex,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TtySize {
    pub cols: u16,
    pub rows: u16,
}

/// Binds a bulk stream to its operation: id, direction, maximum
/// bytes, digest and deadline. The CP allocates `stream_id` per bulk session.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StreamBinding {
    pub stream_id: u32,
    pub direction: StreamDirection,
    /// Must not exceed the capability's `maxBytes`.
    pub max_bytes: U53,
    /// Expected SHA-256 of an inbound payload, verified before it is committed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<Sha256Hex>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deadline_unix_ms: Option<UnixMs>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tty: Option<TtySize>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReclaimTarget {
    Images,
    BuildCache,
    Containers,
    BranchPool,
}

/// A document whose schema is owned by another component, carried as exact bytes
/// so its digest is stable across languages.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpaqueDocument {
    /// Schema name and version, e.g. `otterd.firewall-policy/1`.
    pub schema: String,
    /// Exact UTF-8 JSON text.
    pub body: String,
    /// SHA-256 of `body`.
    pub digest: Sha256Hex,
}

impl OpaqueDocument {
    #[must_use]
    pub fn digest_matches(&self) -> bool {
        Sha256Hex::digest(self.body.as_bytes()) == self.digest
    }
}

/// One request payload. Internally tagged by `verb`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "verb", deny_unknown_fields)]
pub enum Command {
    // ---- Frozen: lifecycle ----
    #[serde(rename = "workload.apply", rename_all = "camelCase")]
    WorkloadApply { grant: SlotGrant, spec: ServiceSpec },
    #[serde(rename = "workload.restart", rename_all = "camelCase")]
    WorkloadRestart { grant_id: GrantId, reason: String },
    #[serde(rename = "workload.stop", rename_all = "camelCase")]
    WorkloadStop {
        grant_id: GrantId,
        reason: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_grace_ms: Option<DurationMs>,
    },
    #[serde(rename = "workload.remove", rename_all = "camelCase")]
    WorkloadRemove { grant_id: GrantId },
    /// Give an adopted container back: the grant is released without a stop
    /// and the container's restart policy is set to `restartPolicy` (its
    /// value before adoption). The process keeps running.
    #[serde(rename = "workload.release-adoption", rename_all = "camelCase")]
    WorkloadReleaseAdoption {
        grant_id: GrantId,
        restart_policy: EngineRestartPolicy,
    },
    #[serde(rename = "workload.inspect", rename_all = "camelCase")]
    WorkloadInspect {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        resource_id: Option<ResourceId>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        grant_ids: Vec<GrantId>,
    },
    #[serde(rename = "workload.logs", rename_all = "camelCase")]
    WorkloadLogs {
        resource_id: ResourceId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        grant_id: Option<GrantId>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        attempt_id: Option<AttemptId>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        since_unix_ms: Option<UnixMs>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tail: Option<u32>,
        follow: bool,
        stream: StreamBinding,
    },
    #[serde(rename = "job.run", rename_all = "camelCase")]
    JobRun {
        grant: SlotGrant,
        spec: ServiceSpec,
        run_id: RunId,
    },
    #[serde(rename = "op.status", rename_all = "camelCase")]
    OpStatus { op_id: OpId },

    // ---- Frozen: node ----
    #[serde(rename = "node.details")]
    NodeDetails {},
    #[serde(rename = "node.health")]
    NodeHealth {},
    #[serde(rename = "node.units")]
    NodeUnits {},
    #[serde(rename = "node.reclaim", rename_all = "camelCase")]
    NodeReclaim { targets: Vec<ReclaimTarget> },
    /// `release` is a signed release manifest (`otterd/release-manifest/v1`).
    #[serde(rename = "node.upgrade", rename_all = "camelCase")]
    NodeUpgrade { release: SignedEnvelope },
    #[serde(rename = "node.decommission", rename_all = "camelCase")]
    NodeDecommission { reason: String },
    /// `certificate` is a new-epoch [`crate::identity::EnrollCertificate`].
    #[serde(rename = "node.reenroll", rename_all = "camelCase")]
    NodeReenroll { certificate: SignedEnvelope },
    #[serde(rename = "node.retireByBarrier", rename_all = "camelCase")]
    NodeRetireByBarrier { evidence: BarrierEvidence },
    /// Interval-keyed sampling: rates are computed against the previous sample
    /// taken for the same `cache_ms`, so a 60 s and a 1 s cadence coexist.
    #[serde(rename = "metrics.sample", rename_all = "camelCase")]
    MetricsSample {
        cache_ms: DurationMs,
        include_details: bool,
    },
    #[serde(rename = "events.subscribe", rename_all = "camelCase")]
    EventsSubscribe {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        since_cursor: Option<String>,
        stream: StreamBinding,
    },
    /// Replace the full set of checks this node executes.
    #[serde(rename = "health.configure", rename_all = "camelCase")]
    HealthConfigure {
        revision: U53,
        checks: Vec<HealthCheck>,
    },

    // ---- Provisional: containers ----
    #[serde(rename = "container.list", rename_all = "camelCase")]
    ContainerList { all: bool, managed_only: bool },
    #[serde(rename = "container.inspect", rename_all = "camelCase")]
    ContainerInspect { container: ContainerRef },
    #[serde(rename = "container.logs", rename_all = "camelCase")]
    ContainerLogs {
        container: ContainerRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        since_unix_ms: Option<UnixMs>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tail: Option<u32>,
        follow: bool,
        stream: StreamBinding,
    },
    #[serde(rename = "container.exec", rename_all = "camelCase")]
    ContainerExec {
        container: ContainerRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        attempt_id: Option<AttemptId>,
        argv: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        user: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        workdir: Option<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        env: Vec<EnvVar>,
        stream: StreamBinding,
    },

    // ---- Provisional: images ----
    #[serde(rename = "image.pull", rename_all = "camelCase")]
    ImagePull {
        reference: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        digest: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        registry_auth_ref: Option<String>,
    },
    #[serde(rename = "image.push", rename_all = "camelCase")]
    ImagePush {
        reference: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        registry_auth_ref: Option<String>,
    },
    #[serde(rename = "image.inspect", rename_all = "camelCase")]
    ImageInspect { reference: String },
    #[serde(rename = "image.list")]
    ImageList {},
    #[serde(rename = "image.remove", rename_all = "camelCase")]
    ImageRemove { reference: String },
    /// Prunes only images that are not GC roots of any retained generation.
    #[serde(rename = "image.prune")]
    ImagePrune {},

    // ---- Provisional: networks ----
    #[serde(rename = "network.list")]
    NetworkList {},
    #[serde(rename = "network.inspect", rename_all = "camelCase")]
    NetworkInspect { name: String },
    #[serde(rename = "network.ensure", rename_all = "camelCase")]
    NetworkEnsure {
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        scope_id: Option<ScopeId>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        subnet: Option<String>,
        internal: bool,
        #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
        labels: BTreeMap<String, String>,
    },
    #[serde(rename = "network.connect", rename_all = "camelCase")]
    NetworkConnect {
        network: String,
        container: ContainerRef,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        aliases: Vec<String>,
    },
    #[serde(rename = "network.disconnect", rename_all = "camelCase")]
    NetworkDisconnect {
        network: String,
        container: ContainerRef,
    },
    #[serde(rename = "network.remove", rename_all = "camelCase")]
    NetworkRemove { name: String },

    // ---- Provisional: volumes and storage ----
    #[serde(rename = "volume.list")]
    VolumeList {},
    #[serde(rename = "volume.inspect", rename_all = "camelCase")]
    VolumeInspect { name: String },
    #[serde(rename = "volume.create", rename_all = "camelCase")]
    VolumeCreate {
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        data_identity: Option<DataIdentity>,
        #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
        labels: BTreeMap<String, String>,
    },
    #[serde(rename = "volume.remove", rename_all = "camelCase")]
    VolumeRemove { name: String },
    #[serde(rename = "volume.fs", rename_all = "camelCase")]
    VolumeFs { volume: String, path: String },
    #[serde(rename = "volume.export", rename_all = "camelCase")]
    VolumeExport {
        volume: String,
        path: String,
        stream: StreamBinding,
    },
    #[serde(rename = "volume.import", rename_all = "camelCase")]
    VolumeImport {
        volume: String,
        path: String,
        stream: StreamBinding,
    },
    #[serde(rename = "volume.snapshot", rename_all = "camelCase")]
    VolumeSnapshot { volume: String, snapshot: String },
    #[serde(rename = "volume.clone", rename_all = "camelCase")]
    VolumeClone {
        source: String,
        target: String,
        data_identity: DataIdentity,
    },
    #[serde(rename = "pool.stats", rename_all = "camelCase")]
    PoolStats { pool: String },
    #[serde(rename = "pool.trim", rename_all = "camelCase")]
    PoolTrim { pool: String },
    #[serde(rename = "pool.grow", rename_all = "camelCase")]
    PoolGrow { pool: String, add_bytes: U53 },

    // ---- Provisional: backups ----
    #[serde(rename = "backup.run", rename_all = "camelCase")]
    BackupRun {
        backup_id: String,
        resource_id: ResourceId,
        repository_ref: String,
    },
    #[serde(rename = "backup.restore", rename_all = "camelCase")]
    BackupRestore {
        backup_id: String,
        resource_id: ResourceId,
        repository_ref: String,
        snapshot: String,
    },
    #[serde(rename = "backup.status", rename_all = "camelCase")]
    BackupStatus { backup_id: String },

    // ---- Provisional: interactive ----
    #[serde(rename = "db.connect", rename_all = "camelCase")]
    DbConnect {
        attempt_id: AttemptId,
        port: u16,
        stream: StreamBinding,
    },
    #[serde(rename = "host.shell", rename_all = "camelCase")]
    HostShell { stream: StreamBinding },

    // ---- Provisional: platform reconcilers ----
    #[serde(rename = "firewall.apply", rename_all = "camelCase")]
    FirewallApply {
        generation: U53,
        policy: OpaqueDocument,
    },
    /// Allowlisted `cscli` subcommands only; never a general shell.
    #[serde(rename = "firewall.cscli", rename_all = "camelCase")]
    FirewallCscli { argv: Vec<String> },
    #[serde(rename = "proxy.apply", rename_all = "camelCase")]
    ProxyApply {
        generation: U53,
        routes: OpaqueDocument,
    },
    #[serde(rename = "proxy.status")]
    ProxyStatus {},
    /// `manifest` is a signed platform boot manifest transition.
    #[serde(rename = "platform.update", rename_all = "camelCase")]
    PlatformUpdate { manifest: SignedEnvelope },
    /// The control plane restored current operations and authority after
    /// starting in recovery mode, and asks to leave it. `manifest_digest`
    /// names the active platform boot manifest; any other is refused.
    #[serde(rename = "platform.recovered", rename_all = "camelCase")]
    PlatformRecovered { manifest_digest: Sha256Hex },
}

impl Command {
    /// The verb this payload is for; must equal the capability's verb.
    #[must_use]
    pub fn verb(&self) -> Verb {
        match self {
            Self::WorkloadApply { .. } => Verb::WorkloadApply,
            Self::WorkloadRestart { .. } => Verb::WorkloadRestart,
            Self::WorkloadStop { .. } => Verb::WorkloadStop,
            Self::WorkloadRemove { .. } => Verb::WorkloadRemove,
            Self::WorkloadReleaseAdoption { .. } => Verb::WorkloadReleaseAdoption,
            Self::WorkloadInspect { .. } => Verb::WorkloadInspect,
            Self::WorkloadLogs { .. } => Verb::WorkloadLogs,
            Self::JobRun { .. } => Verb::JobRun,
            Self::OpStatus { .. } => Verb::OpStatus,
            Self::NodeDetails {} => Verb::NodeDetails,
            Self::NodeHealth {} => Verb::NodeHealth,
            Self::NodeUnits {} => Verb::NodeUnits,
            Self::NodeReclaim { .. } => Verb::NodeReclaim,
            Self::NodeUpgrade { .. } => Verb::NodeUpgrade,
            Self::NodeDecommission { .. } => Verb::NodeDecommission,
            Self::NodeReenroll { .. } => Verb::NodeReenroll,
            Self::NodeRetireByBarrier { .. } => Verb::NodeRetireByBarrier,
            Self::MetricsSample { .. } => Verb::MetricsSample,
            Self::EventsSubscribe { .. } => Verb::EventsSubscribe,
            Self::HealthConfigure { .. } => Verb::HealthConfigure,
            Self::ContainerList { .. } => Verb::ContainerList,
            Self::ContainerInspect { .. } => Verb::ContainerInspect,
            Self::ContainerLogs { .. } => Verb::ContainerLogs,
            Self::ContainerExec { .. } => Verb::ContainerExec,
            Self::ImagePull { .. } => Verb::ImagePull,
            Self::ImagePush { .. } => Verb::ImagePush,
            Self::ImageInspect { .. } => Verb::ImageInspect,
            Self::ImageList {} => Verb::ImageList,
            Self::ImageRemove { .. } => Verb::ImageRemove,
            Self::ImagePrune {} => Verb::ImagePrune,
            Self::NetworkList {} => Verb::NetworkList,
            Self::NetworkInspect { .. } => Verb::NetworkInspect,
            Self::NetworkEnsure { .. } => Verb::NetworkEnsure,
            Self::NetworkConnect { .. } => Verb::NetworkConnect,
            Self::NetworkDisconnect { .. } => Verb::NetworkDisconnect,
            Self::NetworkRemove { .. } => Verb::NetworkRemove,
            Self::VolumeList {} => Verb::VolumeList,
            Self::VolumeInspect { .. } => Verb::VolumeInspect,
            Self::VolumeCreate { .. } => Verb::VolumeCreate,
            Self::VolumeRemove { .. } => Verb::VolumeRemove,
            Self::VolumeFs { .. } => Verb::VolumeFs,
            Self::VolumeExport { .. } => Verb::VolumeExport,
            Self::VolumeImport { .. } => Verb::VolumeImport,
            Self::VolumeSnapshot { .. } => Verb::VolumeSnapshot,
            Self::VolumeClone { .. } => Verb::VolumeClone,
            Self::PoolStats { .. } => Verb::PoolStats,
            Self::PoolTrim { .. } => Verb::PoolTrim,
            Self::PoolGrow { .. } => Verb::PoolGrow,
            Self::BackupRun { .. } => Verb::BackupRun,
            Self::BackupRestore { .. } => Verb::BackupRestore,
            Self::BackupStatus { .. } => Verb::BackupStatus,
            Self::DbConnect { .. } => Verb::DbConnect,
            Self::HostShell { .. } => Verb::HostShell,
            Self::FirewallApply { .. } => Verb::FirewallApply,
            Self::FirewallCscli { .. } => Verb::FirewallCscli,
            Self::ProxyApply { .. } => Verb::ProxyApply,
            Self::ProxyStatus {} => Verb::ProxyStatus,
            Self::PlatformUpdate { .. } => Verb::PlatformUpdate,
            Self::PlatformRecovered { .. } => Verb::PlatformRecovered,
        }
    }

    /// The bulk stream this command opens, if any.
    #[must_use]
    pub fn stream(&self) -> Option<&StreamBinding> {
        match self {
            Self::WorkloadLogs { stream, .. }
            | Self::EventsSubscribe { stream, .. }
            | Self::ContainerLogs { stream, .. }
            | Self::ContainerExec { stream, .. }
            | Self::VolumeExport { stream, .. }
            | Self::VolumeImport { stream, .. }
            | Self::DbConnect { stream, .. }
            | Self::HostShell { stream } => Some(stream),
            _ => None,
        }
    }
}

/// Whether a failed operation may have had effects.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SideEffects {
    None,
    Possible,
}

/// Typed results. Lane-owned read verbs answer with [`CommandResult::Document`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum CommandResult {
    Done,
    /// A grant was installed and its first attempt submitted.
    #[serde(rename_all = "camelCase")]
    Applied {
        grant_id: GrantId,
        attempt_id: AttemptId,
    },
    /// Positive stop: `certificate` is a node-signed
    /// [`crate::lifecycle::StopCertificate`].
    Stopped {
        certificate: SignedEnvelope,
    },
    /// Start authority revoked, but positive stop is not established; the slot
    /// stays Unknown and the CP keeps its ownership barrier.
    #[serde(rename_all = "camelCase")]
    StopUnresolved {
        grant_id: GrantId,
        reasons: Vec<String>,
    },
    Slots {
        slots: Vec<SlotReport>,
    },
    /// `op.status` answer.
    Operation {
        record: Box<OperationRecord>,
    },
    #[serde(rename_all = "camelCase")]
    StreamOpened {
        stream_id: u32,
    },
    /// An adopted container was given back, still running, with its
    /// restart policy restored.
    #[serde(rename_all = "camelCase")]
    AdoptionReleased {
        grant_id: GrantId,
        container: ContainerRef,
    },
    /// Every earlier Engine submission was retired by the barrier.
    #[serde(rename_all = "camelCase")]
    Retired {
        mutation_count: u32,
    },
    /// A result whose schema is owned by another component (`schema` names it).
    Document {
        schema: String,
        body: serde_json::Value,
    },
}

/// Outcome of one operation, as journalled and as answered.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "kebab-case", deny_unknown_fields)]
pub enum OpOutcome {
    /// Claimed; progress follows; the final outcome comes in a later response.
    Accepted,
    Completed {
        result: CommandResult,
    },
    #[serde(rename_all = "camelCase")]
    Failed {
        code: String,
        message: String,
        side_effects: SideEffects,
    },
    /// The outcome cannot be established (for example an Engine submission
    /// without a terminal response). Reconcile; never retry blindly.
    Unknown {
        reason: String,
    },
    /// Same `opId` with a different payload hash: a conflict, not a retry.
    #[serde(rename_all = "camelCase")]
    Conflict {
        recorded_payload_hash: Sha256Hex,
    },
    /// Refused before the claim; no side effect, no journal record.
    Rejected {
        error: CapabilityError,
    },
}

impl OpOutcome {
    #[must_use]
    pub fn is_terminal(&self) -> bool {
        !matches!(self, Self::Accepted)
    }
}

/// What the journal knows about one `opId`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationRecord {
    pub op_id: OpId,
    pub verb: Verb,
    pub payload_hash: Sha256Hex,
    pub claimed_at_unix_ms: UnixMs,
    pub outcome: OpOutcome,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_verb_has_a_command() {
        // `verb()` is exhaustive over Command; check the inverse direction by name.
        let samples = [
            r#"{"verb":"node.details"}"#,
            r#"{"verb":"op.status","opId":"op-1"}"#,
            r#"{"verb":"workload.stop","grantId":"g-1","reason":"drain"}"#,
        ];
        for s in samples {
            let c: Command = serde_json::from_str(s).unwrap();
            assert_eq!(serde_json::to_value(&c).unwrap()["verb"], c.verb().as_str());
        }
    }

    #[test]
    fn unknown_arguments_are_refused() {
        assert!(
            serde_json::from_str::<Command>(r#"{"verb":"op.status","opId":"op-1","force":true}"#)
                .is_err()
        );
        assert!(serde_json::from_str::<Command>(r#"{"verb":"node.details","x":1}"#).is_err());
        assert!(serde_json::from_str::<Command>(r#"{"verb":"node.nope"}"#).is_err());
    }

    #[test]
    fn opaque_documents_check_their_digest() {
        let body = r#"{"a":1}"#.to_owned();
        let doc = OpaqueDocument {
            schema: "x/1".into(),
            digest: Sha256Hex::digest(body.as_bytes()),
            body,
        };
        assert!(doc.digest_matches());
        let mut bad = doc;
        bad.body.push(' ');
        assert!(!bad.digest_matches());
    }
}
