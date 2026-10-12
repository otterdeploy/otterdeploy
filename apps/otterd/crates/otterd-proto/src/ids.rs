//! Identifiers and digests.
//!
//! Every identifier on the wire is an opaque, validated string. Identities that
//! cross the Engine boundary (attempts, mutations, holds) are minted once by the
//! node and never reused, including on rollback (MODEL §2.2.1). Identities the
//! control plane owns (installs, nodes, grants, operations) are only ever parsed.

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::fmt;
use std::str::FromStr;

/// Longest identifier accepted on the wire.
pub const MAX_ID_LEN: usize = 128;

/// An identifier or digest failed validation.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum IdError {
    #[error("{kind} must be 1..={MAX_ID_LEN} characters, got {len}")]
    Length { kind: &'static str, len: usize },
    #[error("{kind} contains a character outside [A-Za-z0-9._:/@+-]")]
    Charset { kind: &'static str },
    #[error("{kind} must be {want} lowercase hex characters")]
    Hex { kind: &'static str, want: usize },
    #[error("{kind} must start with {prefix}")]
    Prefix {
        kind: &'static str,
        prefix: &'static str,
    },
}

fn is_id_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '/' | '@' | '+' | '-')
}

fn validate_id(kind: &'static str, raw: &str) -> Result<(), IdError> {
    if raw.is_empty() || raw.len() > MAX_ID_LEN {
        return Err(IdError::Length {
            kind,
            len: raw.len(),
        });
    }
    if !raw.chars().all(is_id_char) {
        return Err(IdError::Charset { kind });
    }
    Ok(())
}

fn validate_hex(kind: &'static str, raw: &str, want: usize) -> Result<(), IdError> {
    if raw.len() == want && raw.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
        Ok(())
    } else {
        Err(IdError::Hex { kind, want })
    }
}

/// 128 random bits from the OS, as lowercase hex.
///
/// The OS RNG failing is unrecoverable for a process that mints identities;
/// the error is surfaced, never replaced by a weaker source.
pub fn random_hex<const N: usize>() -> Result<String, getrandom::Error> {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes)?;
    Ok(hex::encode(bytes))
}

macro_rules! wire_id {
    ($(#[$meta:meta])* $name:ident) => {
        $(#[$meta])*
        #[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        #[serde(try_from = "String", into = "String")]
        pub struct $name(String);

        impl $name {
            /// Validate an identifier received from an authority or a peer.
            pub fn new(raw: impl Into<String>) -> Result<Self, IdError> {
                let raw = raw.into();
                validate_id(stringify!($name), &raw)?;
                Ok(Self(raw))
            }

            #[must_use]
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl TryFrom<String> for $name {
            type Error = IdError;
            fn try_from(raw: String) -> Result<Self, Self::Error> {
                Self::new(raw)
            }
        }

        impl FromStr for $name {
            type Err = IdError;
            fn from_str(raw: &str) -> Result<Self, Self::Err> {
                Self::new(raw)
            }
        }

        impl From<$name> for String {
            fn from(id: $name) -> Self {
                id.0
            }
        }

        impl AsRef<str> for $name {
            fn as_ref(&self) -> &str {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&self.0)
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}({})", stringify!($name), self.0)
            }
        }
    };
}

macro_rules! minted_id {
    ($(#[$meta:meta])* $name:ident, $prefix:literal) => {
        wire_id!($(#[$meta])* $name);

        impl $name {
            /// Prefix of every identifier this node mints of this kind.
            pub const PREFIX: &'static str = $prefix;

            /// Mint a fresh, never-reused identifier (`<prefix>_<128 random bits>`).
            pub fn mint() -> Result<Self, getrandom::Error> {
                Ok(Self(format!(concat!($prefix, "_{}"), random_hex::<16>()?)))
            }
        }
    };
}

wire_id!(
    /// One otterdeploy installation (one authoritative control-plane database).
    InstallId
);
wire_id!(
    /// Tenant organization.
    OrgId
);
wire_id!(
    /// Physical node identity. Stable across daemon restarts; a re-enrollment keeps
    /// the id and advances the node epoch.
    NodeId
);
wire_id!(
    /// A control-plane resource (service, database, job definition).
    ResourceId
);
wire_id!(
    /// A control-plane grant: start authority for one slot generation on one node epoch.
    GrantId
);
wire_id!(
    /// Idempotency key of one control-plane operation (PLAN §5.3).
    OpId
);
wire_id!(
    /// One authenticated control-channel session. Bulk sessions bind to it.
    SessionId
);
wire_id!(
    /// Kernel boot identity (`/proc/sys/kernel/random/boot_id`).
    BootId
);
wire_id!(
    /// A durable job run; survives attempts (MODEL §2.5).
    RunId
);
wire_id!(
    /// A health check definition (MONITORING §5).
    CheckId
);
wire_id!(
    /// The subject of a health or metric series: a node, a resource or an attempt.
    SubjectId
);
wire_id!(
    /// A network scope (environment-level isolation domain).
    ScopeId
);
wire_id!(
    /// A stable per-service virtual address.
    VipId
);
wire_id!(
    /// Normalized writable-data identity (MODEL §2.6).
    DataIdentity
);
wire_id!(
    /// A concurrency group that serializes jobs, hooks and singleton services.
    ConcurrencyGroup
);
wire_id!(
    /// A Docker container id or immutable container name.
    ContainerRef
);
wire_id!(
    /// A recorded fence or barrier evidence row.
    EvidenceId
);

minted_id!(
    /// One process attempt under a grant: a new container per attempt.
    AttemptId,
    "att"
);
minted_id!(
    /// One Engine mutation (create/start/restart/stop/kill/remove).
    MutationId,
    "mut"
);
minted_id!(
    /// A retained mount hold (MODEL §2.6.1).
    HoldId,
    "hold"
);
minted_id!(
    /// A platform update transaction (MODEL §2.7).
    UpdateId,
    "upd"
);
minted_id!(
    /// One otterd process lifetime. A grant never survives a new incarnation.
    Incarnation,
    "inc"
);
minted_id!(
    /// A telemetry batch, for acknowledgement and deduplication.
    BatchId,
    "batch"
);

/// An exclusive slot is `(resourceId, slotIndex)` (MODEL §2.1).
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SlotRef {
    pub resource_id: ResourceId,
    pub index: u32,
}

impl SlotRef {
    #[must_use]
    pub fn new(resource_id: ResourceId, index: u32) -> Self {
        Self { resource_id, index }
    }
}

impl fmt::Display for SlotRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}#{}", self.resource_id, self.index)
    }
}

impl fmt::Debug for SlotRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "SlotRef({self})")
    }
}

macro_rules! hex_value {
    ($(#[$meta:meta])* $name:ident, $len:literal) => {
        $(#[$meta])*
        #[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        #[serde(try_from = "String", into = "String")]
        pub struct $name(String);

        impl $name {
            /// Number of lowercase hex characters.
            pub const LEN: usize = $len;

            pub fn new(raw: impl Into<String>) -> Result<Self, IdError> {
                let raw = raw.into();
                validate_hex(stringify!($name), &raw, $len)?;
                Ok(Self(raw))
            }

            #[must_use]
            pub fn as_str(&self) -> &str {
                &self.0
            }

            /// Wrap hex this crate produced itself (already the right length and case).
            #[allow(dead_code)]
            pub(crate) fn from_trusted_hex(raw: String) -> Self {
                debug_assert!(validate_hex(stringify!($name), &raw, $len).is_ok());
                Self(raw)
            }
        }

        impl TryFrom<String> for $name {
            type Error = IdError;
            fn try_from(raw: String) -> Result<Self, Self::Error> {
                Self::new(raw)
            }
        }

        impl From<$name> for String {
            fn from(v: $name) -> Self {
                v.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&self.0)
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}({})", stringify!($name), self.0)
            }
        }
    };
}

hex_value!(
    /// SHA-256 as 64 lowercase hex characters.
    Sha256Hex,
    64
);
hex_value!(
    /// A single-use 256-bit nonce.
    Nonce,
    64
);
hex_value!(
    /// Short stable id of a public key: the first 16 bytes of SHA-256(key), hex.
    KeyId,
    32
);

impl Sha256Hex {
    /// Digest of exact bytes.
    #[must_use]
    pub fn digest(bytes: &[u8]) -> Self {
        Self(hex::encode(Sha256::digest(bytes)))
    }
}

impl Nonce {
    /// A fresh nonce from the OS RNG.
    pub fn random() -> Result<Self, getrandom::Error> {
        Ok(Self(random_hex::<32>()?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_validated_on_decode() {
        assert!(serde_json::from_str::<NodeId>(r#""node-1""#).is_ok());
        assert!(serde_json::from_str::<NodeId>(r#""""#).is_err());
        assert!(serde_json::from_str::<NodeId>(r#""has space""#).is_err());
        assert!(serde_json::from_str::<NodeId>(&format!("\"{}\"", "a".repeat(129))).is_err());
        assert!(serde_json::from_str::<GrantId>(r#""g\n1""#).is_err());
    }

    #[test]
    fn minted_ids_are_prefixed_and_distinct() {
        let a = AttemptId::mint().unwrap();
        let b = AttemptId::mint().unwrap();
        assert!(a.as_str().starts_with("att_"));
        assert_eq!(a.as_str().len(), "att_".len() + 32);
        assert_ne!(a, b);
    }

    #[test]
    fn hex_values_are_exact() {
        let d = Sha256Hex::digest(b"abc");
        assert_eq!(
            d.as_str(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert!(Sha256Hex::new("ABC").is_err());
        assert!(Sha256Hex::new(d.as_str().to_uppercase()).is_err());
        assert_eq!(Nonce::random().unwrap().as_str().len(), 64);
    }

    #[test]
    fn slot_ref_is_camel_case_and_strict() {
        let s: SlotRef = serde_json::from_str(r#"{"resourceId":"svc","index":2}"#).unwrap();
        assert_eq!(s.to_string(), "svc#2");
        assert!(
            serde_json::from_str::<SlotRef>(r#"{"resourceId":"svc","index":2,"x":1}"#).is_err()
        );
    }
}
