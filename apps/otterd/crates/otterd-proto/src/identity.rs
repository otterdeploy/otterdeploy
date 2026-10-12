//! Node identity, enrollment and key rotation (PLAN §5.1, §5.2).
//!
//! A node generates three keys locally and never sends a private key anywhere:
//! an Ed25519 identity key (signs session proofs, stop certificates, snapshots),
//! an X25519 key (encrypts the node's local cache of secrets and specs) and a
//! WireGuard key. The control plane's signing key and the offline recovery key
//! are pinned at enrollment. Enrollment is single-use and short-lived; the node
//! proves possession of its identity key over the enrollment token.

use crate::envelope::{PublicKey, SignedEnvelope};
use crate::ids::{InstallId, KeyId, NodeId, Nonce};
use crate::num::{U53, UnixMs};
use serde::{Deserialize, Serialize};

/// What a node may be asked to do (PLAN §3).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NodeRole {
    Worker,
    Edge,
    Build,
    Registry,
    /// External monitor: no Docker, no mesh, no scheduling (MONITORING §4).
    Monitor,
    /// Runs the host-pinned platform bootstrap members (MODEL §2.7).
    Platform,
}

impl NodeRole {
    pub const ALL: [Self; 6] = [
        Self::Worker,
        Self::Edge,
        Self::Build,
        Self::Registry,
        Self::Monitor,
        Self::Platform,
    ];
}

/// Provider machine binding. Fencing addresses the immutable provider id,
/// never a name or an IP (MODEL §2.3).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderBinding {
    /// Fence adapter name, for example `hetzner`.
    pub provider: String,
    pub server_id: String,
    /// Provider creation time, guarding against a recycled server id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

/// Immutable host identity; a cloned disk on another machine does not match.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostBinding {
    /// `/etc/machine-id`.
    pub machine_id: String,
    /// DMI product UUID when readable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_uuid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<ProviderBinding>,
}

/// Static facts reported once per connection.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostFacts {
    pub hostname: String,
    /// `amd64` or `arm64`.
    pub arch: String,
    pub os_id: String,
    pub os_version: String,
    pub kernel: String,
    pub cpu_cores: u32,
    pub memory_bytes: U53,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docker_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub systemd_version: Option<String>,
}

/// The public half of a node's keys at one key epoch.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NodeKeys {
    /// Increments on every rotation of any of the three keys.
    pub key_epoch: U53,
    pub identity: PublicKey,
    /// X25519 public key (base64 of 32 bytes).
    pub cache_encryption: PublicKey,
    /// WireGuard public key (base64 of 32 bytes).
    pub wireguard: PublicKey,
}

/// Node → CP over HTTPS, signed with the new identity key (proof of possession).
/// Binding the single-use token inside the signed payload stops a token from
/// being replayed for a different key.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnrollRequest {
    pub token: String,
    pub nonce: Nonce,
    pub keys: NodeKeys,
    pub host: HostBinding,
    pub facts: HostFacts,
    pub requested_roles: Vec<NodeRole>,
    pub otterd_version: String,
}

/// A control-plane signing key the node trusts, with its validity.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrustedKey {
    pub key: PublicKey,
    /// Monotonic signing-key epoch.
    pub epoch: U53,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub not_after_unix_ms: Option<UnixMs>,
}

/// Where the off-node recovery anchor lives (MODEL §2.7); absent in the
/// local-only single-host profile.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnchorLocation {
    pub endpoint: String,
    pub bucket: String,
    pub prefix: String,
    pub region: String,
}

/// CP → node, signed by the CP signing key (`otterd/enroll/v1`). Also the
/// payload of a re-enrollment with a new node epoch.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnrollCertificate {
    pub install_id: InstallId,
    pub node_id: NodeId,
    pub node_epoch: U53,
    pub authority_term: U53,
    pub roles: Vec<NodeRole>,
    /// The identity key this certificate binds.
    pub identity_key_id: KeyId,
    pub key_epoch: U53,
    pub host: HostBinding,
    pub cp_keys: Vec<TrustedKey>,
    /// Offline install recovery key, pinned into the host guard (MODEL §2.7).
    pub recovery_key: PublicKey,
    /// `wss://…/api/otterd/connect`.
    pub control_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<AnchorLocation>,
    pub issued_at_unix_ms: UnixMs,
    /// Why a new epoch was issued (`initial`, `fenced`, `journal-loss`, …).
    pub reason: String,
}

/// Node key rotation statement. Carried as two envelopes over the same payload:
/// one signed by the outgoing identity key, one by the incoming key.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KeyRotation {
    pub install_id: InstallId,
    pub node_id: NodeId,
    pub node_epoch: U53,
    pub from_key_epoch: U53,
    pub new_keys: NodeKeys,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CrossSigned {
    /// Signed by the outgoing key.
    pub by_old: SignedEnvelope,
    /// Signed by the incoming key, over byte-identical payload.
    pub by_new: SignedEnvelope,
}

/// Control-plane signing-key transition (PLAN §5.2): nodes accept both keys
/// until `old_valid_until`, and acknowledge the transition epoch.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CpKeyTransition {
    pub install_id: InstallId,
    pub from_key_id: KeyId,
    pub to: TrustedKey,
    pub old_valid_until_unix_ms: UnixMs,
}

/// Recovery-root-signed revocation of all authority below a term
/// (`otterd/authority-revoke/v1`, MODEL §2.7). Delivered by the recovery tool,
/// over the control channel or written to disk from a rescue system.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityRevocation {
    pub install_id: InstallId,
    pub below_term: U53,
    /// Nodes this revocation targets; empty = every node of the install.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nodes: Vec<NodeId>,
    pub issued_at_unix_ms: UnixMs,
    pub reason: String,
}
