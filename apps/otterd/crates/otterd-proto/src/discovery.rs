//! Discovery replication, freshness challenges, serving sets and peer
//! reachability.
//!
//! A snapshot arriving by any path is data only; freshness comes exclusively
//! from an owner's signed answer to a receiver's single-use challenge, and
//! eligibility expires at `challengeSentAt + TTL`, never at receipt.

use crate::ids::{
    AttemptId, BootId, GrantId, InstallId, KeyId, NodeId, Nonce, ScopeId, Sha256Hex, SlotRef, VipId,
};
use crate::num::{DurationMs, U53};
use crate::spec::PortProtocol;
use serde::{Deserialize, Serialize};

/// Largest chunk of a full snapshot.
pub const MAX_CHUNK_BYTES: usize = 64 * 1024;
/// Largest assembled full set.
pub const MAX_FULL_SET_BYTES: usize = 4 * 1024 * 1024;
/// Challenge answer window W.
pub const CHALLENGE_WINDOW_MS: u64 = 5_000;
/// Owner eligibility TTL.
pub const ELIGIBILITY_TTL_MS: u64 = 30_000;
/// Per-receiver drain bound after installing a withdrawal.
pub const MAX_DRAIN_MS: u64 = 30_000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EndpointPort {
    pub protocol: PortProtocol,
    pub port: u16,
}

/// One published attempt endpoint.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Endpoint {
    pub grant_id: GrantId,
    pub slot: SlotRef,
    pub generation: U53,
    pub attempt_id: AttemptId,
    pub address: String,
    pub ports: Vec<EndpointPort>,
    pub readiness_revision: U53,
    pub scope_id: ScopeId,
}

/// Owner-signed full set (`otterd/owner-snapshot/v1`). Atomically replaces the
/// owner's previous set; omission deletes; an empty set is meaningful.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OwnerSnapshot {
    pub node_id: NodeId,
    pub node_epoch: U53,
    pub publisher_incarnation: U53,
    pub seq: U53,
    pub membership_epoch: U53,
    pub placement_revision: U53,
    pub full_set_digest: Sha256Hex,
    pub endpoints: Vec<Endpoint>,
}

/// Receiver → owner, through any path. `nonce` is single use.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FreshnessChallenge {
    pub receiver_id: NodeId,
    pub receiver_boot: BootId,
    pub owner_id: NodeId,
    pub nonce: Nonce,
}

/// Owner-signed answer (`otterd/challenge-answer/v1`). A relay can carry it but
/// cannot produce it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChallengeAnswer {
    pub receiver_id: NodeId,
    pub receiver_boot: BootId,
    pub nonce: Nonce,
    pub snapshot_digest: Sha256Hex,
    pub seq: U53,
    pub owner_epoch: U53,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServingAttempt {
    pub grant_id: GrantId,
    pub attempt_id: AttemptId,
    pub node_epoch: U53,
    pub address: String,
    pub ports: Vec<EndpointPort>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Withdrawal {
    pub attempt_id: AttemptId,
    pub withdrawal_revision: U53,
    pub drain_budget_ms: DurationMs,
}

/// CP-signed exact serving set for one VIP (`otterd/serving-set/v1`). Each
/// receiver installs one revision atomically; a candidate outside the set only
/// receives readiness probes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServingSet {
    pub install_id: InstallId,
    pub authority_term: U53,
    pub scope_id: ScopeId,
    pub vip_id: VipId,
    /// The VIP's IPv4 address (allocated by the control plane, never reused).
    pub vip_address: String,
    /// Fully qualified names (the service name and its aliases, under the
    /// scope's zone) that resolve to the VIP in this scope's view.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub names: Vec<String>,
    /// Ports the VIP forwards; each goes to the same port on a backend.
    pub ports: Vec<EndpointPort>,
    pub serving_revision: U53,
    pub operation_epoch: U53,
    pub new_flow_attempts: Vec<ServingAttempt>,
    pub withdrawals: Vec<Withdrawal>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MemberStatus {
    Active,
    Cordoned,
    Draining,
    /// Barred until rejoin (fenced or awaiting reconciliation).
    Barred,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Member {
    pub node_id: NodeId,
    pub node_epoch: U53,
    pub identity_key_id: KeyId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mesh_address: Option<String>,
    pub status: MemberStatus,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemberTombstone {
    pub node_id: NodeId,
    /// Every epoch at or below this is removed for good.
    pub through_epoch: U53,
}

/// CP-signed membership revision (`otterd/membership/v1`). Removal is a
/// retained tombstone so replay cannot re-add a node.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Membership {
    pub install_id: InstallId,
    pub authority_term: U53,
    pub membership_epoch: U53,
    pub members: Vec<Member>,
    pub tombstones: Vec<MemberTombstone>,
}

/// One chunk of a signed full snapshot envelope (anti-entropy transport).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SnapshotChunk {
    pub owner_id: NodeId,
    pub seq: U53,
    /// SHA-256 of the whole assembled envelope bytes.
    pub snapshot_digest: Sha256Hex,
    pub index: u32,
    pub count: u32,
    pub total_bytes: u32,
    /// Standard base64 of at most [`MAX_CHUNK_BYTES`] bytes.
    pub data: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DigestEntry {
    pub owner_id: NodeId,
    pub owner_epoch: U53,
    pub seq: U53,
    pub full_set_digest: Sha256Hex,
}

/// Peer reachability challenge. Reports never extend leases or prove stop.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PeerChallenge {
    pub challenger_id: NodeId,
    pub target_id: NodeId,
    pub nonce: Nonce,
}

/// Target-signed answer (`otterd/peer-answer/v1`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PeerAnswer {
    pub node_id: NodeId,
    pub boot_id: BootId,
    pub nonce: Nonce,
    pub last_observed_cp_term: U53,
}

/// Discovery messages; peer-to-peer over the mesh, or relayed by the CP.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum DiscoveryMessage {
    Challenge {
        challenge: FreshnessChallenge,
    },
    /// `answer` is a signed [`ChallengeAnswer`].
    Answer {
        answer: crate::envelope::SignedEnvelope,
    },
    Chunk {
        chunk: SnapshotChunk,
    },
    Digests {
        entries: Vec<DigestEntry>,
    },
    #[serde(rename_all = "camelCase")]
    PullFullSet {
        owner_id: NodeId,
    },
    PeerChallenge {
        challenge: PeerChallenge,
    },
    /// `answer` is a signed [`PeerAnswer`].
    PeerAnswer {
        answer: crate::envelope::SignedEnvelope,
    },
}
