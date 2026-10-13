//! The node journal record schema.
//!
//! Each record is one durable fact, appended and fsynced before the side
//! effect it authorizes. Records are never rewritten; the node's state is the
//! fold of all records in order. Compaction writes a new file that keeps every
//! record still referenced by an open obligation, preceded by [`Record::Format`]
//! and [`Record::Compacted`], so the schema has no separate snapshot form.
//!
//! On disk: an 8-byte file header, `b"ODJ1"` then the journal format as
//! `u32 LE`, followed by frames of `len: u32 LE`, `crc32c(json): u32 LE`, then
//! `len` bytes of UTF-8 JSON [`Entry`]. A torn final frame is truncated on open;
//! a bad frame anywhere else refuses to open (journal corruption is recovery,
//! not auto-repair). The bootstrap journal uses the same schema in
//! a separate root-only file.
//!
//! The control plane never parses the live journal; it receives exports for
//! recovery inventory, hence the TypeScript mirror.

use crate::capability::Verb;
use crate::command::OpOutcome;
use crate::envelope::{PublicKey, SignedEnvelope};
use crate::identity::{HostBinding, TrustedKey};
use crate::ids::{
    AttemptId, BootId, ContainerRef, DataIdentity, GrantId, HoldId, Incarnation, InstallId, KeyId,
    MutationId, NodeId, OpId, ResourceId, SessionId, Sha256Hex, SlotRef, UpdateId,
};
use crate::lifecycle::{
    AttemptFailure, BarrierEvidence, EngineRestartPolicy, EngineVerb, SlotGrant,
};
use crate::num::{U53, UnixMs};
use serde::{Deserialize, Serialize};

/// Largest single entry accepted when reading a journal.
pub const MAX_ENTRY_BYTES: u32 = 1024 * 1024;
/// Magic bytes at the start of every journal file.
pub const FILE_MAGIC: &[u8; 4] = b"ODJ1";
/// Bytes of the file header (magic + format).
pub const FILE_HEADER_LEN: usize = 8;
/// Bytes of framing before each entry's JSON.
pub const FRAME_HEADER_LEN: usize = 8;

/// Which authority a mutation runs under.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorkloadClass {
    /// Needs a fresh CP grant after every process start.
    Tenant,
    /// CP-managed system workload (builder, CrowdSec): a normal CP grant, never
    /// bootstrap authority.
    System,
    /// Host-pinned platform bootstrap member under the signed boot manifest.
    Platform,
}

/// A mutation as recorded before it crosses the Engine boundary.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MutationRecord {
    pub mutation_id: MutationId,
    pub class: WorkloadClass,
    pub slot: SlotRef,
    /// Tenant and system mutations bind a grant; platform mutations bind the
    /// active manifest instead.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grant_id: Option<GrantId>,
    pub attempt_id: AttemptId,
    pub verb: EngineVerb,
    /// Immutable per-attempt container name; never a mutable service name.
    pub object_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub container: Option<ContainerRef>,
    /// SHA-256 of the exact request sent to the Engine.
    pub payload_hash: Sha256Hex,
}

/// A definitive terminal Engine response for one mutation.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum EngineOutcome {
    Created {
        container: ContainerRef,
    },
    Started,
    AlreadyStarted,
    Restarted,
    Stopped,
    AlreadyStopped,
    Removed,
    Paused,
    Unpaused,
    /// The restart policy was updated.
    Updated,
    /// The Engine answered that the object does not exist.
    Absent,
    /// A definitive refusal: the request completed without effect.
    Refused {
        status: u16,
        message: String,
    },
}

/// How a mutation was retired without a terminal Engine response.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Retirement {
    /// Never crossed the Engine boundary; retired under the submission lock.
    NotSubmitted,
    /// A validated external barrier (provider fence or manual proof).
    ExternalBarrier { evidence: BarrierEvidence },
    /// The kernel boot changed since submission and the operator enabled the
    /// host-reboot barrier profile for this Engine (disabled by default).
    #[serde(rename_all = "camelCase")]
    HostReboot {
        submitted_boot_id: BootId,
        observed_boot_id: BootId,
        profile: String,
    },
}

/// Filesystem identity of a retained mount source.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackingIdentity {
    pub dev: U53,
    pub ino: U53,
    pub mnt_id: U53,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HoldRecord {
    pub hold_id: HoldId,
    pub data_identity: DataIdentity,
    pub claim_epoch: U53,
    pub source_path: String,
    pub staging_path: String,
    pub slot: SlotRef,
    pub attempt_id: AttemptId,
}

/// Platform update phases. `SchemaBoundary` is the first
/// irreversible step: from there only recover-forward or disaster recovery.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdatePhase {
    Staged,
    CpQuiesced,
    CpStopped,
    SchemaBoundary,
    NewCpStarted,
    Committed,
    RolledBack,
}

impl UpdatePhase {
    #[must_use]
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Committed | Self::RolledBack)
    }

    /// Rollback is allowed only before the schema boundary.
    #[must_use]
    pub fn can_roll_back(self) -> bool {
        self < Self::SchemaBoundary
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AttemptReason {
    Initial,
    /// Supervisor restart consuming the delegated budget.
    Restart,
    /// Operator restart through `workload.restart`.
    Manual,
    /// A running container started outside otterd, adopted in place.
    AdoptedContainer,
}

/// Monotonic counters that must survive restarts.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum HighWaterKind {
    /// Highest grant generation accepted for a slot; scope = `resource#index`.
    SlotGeneration,
    OperationEpoch,
    ServingRevision,
    MembershipEpoch,
    PublisherSeq,
    SampleSeq,
    SlotReportSeq,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Record {
    /// First record of every journal file.
    #[serde(rename_all = "camelCase")]
    Format {
        journal_format: u16,
        otterd_version: String,
    },
    /// Written by enrollment or a re-enrollment with a new epoch. Without it the
    /// node has no trusted ownership inventory and refuses every start.
    #[serde(rename_all = "camelCase")]
    Identity {
        install_id: InstallId,
        node_id: NodeId,
        node_epoch: U53,
        key_epoch: U53,
        identity_key_id: KeyId,
        cp_keys: Vec<TrustedKey>,
        recovery_key: PublicKey,
        host: HostBinding,
    },
    #[serde(rename_all = "camelCase")]
    KeysRotated {
        key_epoch: U53,
        identity_key_id: KeyId,
    },
    #[serde(rename_all = "camelCase")]
    CpKeysChanged {
        cp_keys: Vec<TrustedKey>,
    },
    /// Every process start: invalidates in-memory leases and enters quarantine.
    #[serde(rename_all = "camelCase")]
    ProcessStarted {
        incarnation: Incarnation,
        boot_id: BootId,
    },
    /// Recovery-root revocation of every authority term below `below_term`.
    #[serde(rename_all = "camelCase")]
    AuthorityRevoked {
        below_term: U53,
        revocation_digest: Sha256Hex,
        reason: String,
    },
    /// Durable claim of `opId + payloadHash`, before any side effect.
    #[serde(rename_all = "camelCase")]
    OpClaimed {
        op_id: OpId,
        verb: Verb,
        payload_hash: Sha256Hex,
        capability_digest: Sha256Hex,
        session_id: SessionId,
        operation_epoch: U53,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        resource_id: Option<ResourceId>,
    },
    #[serde(rename_all = "camelCase")]
    OpCompleted {
        op_id: OpId,
        outcome: OpOutcome,
    },
    #[serde(rename_all = "camelCase")]
    GrantAccepted {
        grant: SlotGrant,
        spec_digest: Sha256Hex,
        op_id: OpId,
    },
    /// After a node restart: an earlier process's exclusive grant is held
    /// (no new starts) instead of stopped, its container paused, until the
    /// control plane adopts or stops it.
    #[serde(rename_all = "camelCase")]
    GrantHeld {
        grant_id: GrantId,
        /// The node process holding it.
        incarnation: Incarnation,
        container: ContainerRef,
        paused: bool,
        /// When this process first held it (node wall clock).
        since_unix_ms: U53,
    },
    /// A new grant adopted a held grant's attempt; the old grant is released
    /// without a stop because its process now belongs to the new one.
    #[serde(rename_all = "camelCase")]
    GrantAdopted {
        grant_id: GrantId,
        by_grant: GrantId,
        attempt_id: AttemptId,
    },
    /// The grant's only attempt is a running container started outside
    /// otterd (`SlotGrant::adopts_container`), bound by its immutable id.
    #[serde(rename_all = "camelCase")]
    ContainerAdopted {
        grant_id: GrantId,
        attempt_id: AttemptId,
        container: ContainerRef,
    },
    /// An adopted container was given back without a stop; the grant is
    /// released and the container's restart policy restored.
    #[serde(rename_all = "camelCase")]
    AdoptionReleased {
        grant_id: GrantId,
        restart_policy: EngineRestartPolicy,
    },
    /// Durable start-authority revocation, written before any stop is sent.
    #[serde(rename_all = "camelCase")]
    GrantRevoked {
        grant_id: GrantId,
        reason: String,
    },
    #[serde(rename_all = "camelCase")]
    AttemptBegun {
        grant_id: GrantId,
        attempt_id: AttemptId,
        ordinal: u32,
        reason: AttemptReason,
    },
    /// The attempt ended before its process could run (its image could not
    /// be pulled, or the Engine refused to create or start it). Terminal:
    /// nothing more is sent for it.
    #[serde(rename_all = "camelCase")]
    AttemptFailed {
        grant_id: GrantId,
        attempt_id: AttemptId,
        failure: AttemptFailure,
    },
    MutationIntent {
        mutation: MutationRecord,
    },
    /// Fsynced before the request is sent; a crash between fsync and send is
    /// treated as sent.
    #[serde(rename_all = "camelCase")]
    MutationSubmitted {
        mutation_id: MutationId,
        boot_id: BootId,
        incarnation: Incarnation,
        /// dockerd identity at send time, for evidence only.
        engine_incarnation: String,
    },
    #[serde(rename_all = "camelCase")]
    MutationSettled {
        mutation_id: MutationId,
        outcome: EngineOutcome,
    },
    #[serde(rename_all = "camelCase")]
    MutationRetired {
        mutation_id: MutationId,
        retirement: Retirement,
    },
    /// The node-signed certificate, kept so a duplicate stop returns it again.
    #[serde(rename_all = "camelCase")]
    StopCertified {
        grant_id: GrantId,
        certificate: SignedEnvelope,
    },
    /// A slot's boot quarantine is lifted for this incarnation.
    #[serde(rename_all = "camelCase")]
    QuarantineCleared {
        slot: SlotRef,
        grant_id: GrantId,
        incarnation: Incarnation,
    },
    HoldIntent {
        hold: HoldRecord,
    },
    #[serde(rename_all = "camelCase")]
    HoldStaged {
        hold_id: HoldId,
        backing: BackingIdentity,
        staging_mnt_id: U53,
    },
    #[serde(rename_all = "camelCase")]
    HoldUnknown {
        hold_id: HoldId,
        reason: String,
    },
    #[serde(rename_all = "camelCase")]
    HoldReleased {
        hold_id: HoldId,
        reason: String,
    },
    /// Platform: the signed boot manifest became active on this host.
    #[serde(rename_all = "camelCase")]
    ManifestActivated {
        manifest_digest: Sha256Hex,
        manifest_revision: U53,
        bootstrap_epoch: U53,
        authority_term: U53,
    },
    #[serde(rename_all = "camelCase")]
    UpdatePhaseEntered {
        update_id: UpdateId,
        phase: UpdatePhase,
        from_manifest_digest: Sha256Hex,
        to_manifest_digest: Sha256Hex,
    },
    /// Platform: the active manifest's control plane restored current
    /// operations and authority, and leaves recovery mode. Accepted only for
    /// the active manifest, and only once per manifest.
    #[serde(rename_all = "camelCase")]
    PlatformRecoveryLeft {
        manifest_digest: Sha256Hex,
    },
    #[serde(rename_all = "camelCase")]
    HighWater {
        kind: HighWaterKind,
        /// Resource, scope or VIP the counter belongs to; empty for node-wide.
        scope: String,
        value: U53,
    },
    /// Follows `Format` in a compacted file.
    #[serde(rename_all = "camelCase")]
    Compacted {
        through_seq: U53,
        dropped_records: U53,
        /// SHA-256 of the previous file, retained alongside it until verified.
        prior_digest: Sha256Hex,
    },
}

/// A record plus its envelope as stored on disk.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entry {
    /// Strictly increasing within a journal, never reset by compaction.
    pub seq: U53,
    pub at_unix_ms: UnixMs,
    pub record: Record,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_phases_order_the_irreversible_boundary() {
        assert!(UpdatePhase::CpStopped.can_roll_back());
        assert!(!UpdatePhase::SchemaBoundary.can_roll_back());
        assert!(!UpdatePhase::NewCpStarted.can_roll_back());
        assert!(UpdatePhase::Committed.is_terminal());
    }

    #[test]
    fn records_are_tagged_and_strict() {
        let e: Entry = serde_json::from_str(
            r#"{"seq":1,"atUnixMs":2,"record":{"type":"processStarted","incarnation":"inc_1","bootId":"b"}}"#,
        )
        .unwrap();
        assert!(matches!(e.record, Record::ProcessStarted { .. }));
        assert!(
            serde_json::from_str::<Entry>(
                r#"{"seq":1,"atUnixMs":2,"record":{"type":"processStarted","incarnation":"inc_1","bootId":"b","x":1}}"#,
            )
            .is_err()
        );
    }
}
