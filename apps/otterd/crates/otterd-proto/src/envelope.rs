//! Signed envelopes.
//!
//! Ed25519 over `context || 0x00 || payload`, where `payload` is the exact
//! serialized bytes. There is no canonicalization step: the signer serializes
//! once, the verifier checks those bytes and only then parses them. The context
//! separates domains, so a signed lease can never verify as a capability and a
//! node's session proof can never verify as the control plane's.

use crate::ids::{KeyId, Sha256Hex};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;
use ed25519_dalek::{Signature, Signer as _, SigningKey, VerifyingKey};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::fmt;

/// Signing domains. The serialized form is the exact context string.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SignContext {
    /// Handshake proof of either end of a session.
    #[serde(rename = "otterd/session/v1")]
    Session,
    /// Per-request authorization.
    #[serde(rename = "otterd/capability/v1")]
    Capability,
    /// Lease renewal answering one node nonce.
    #[serde(rename = "otterd/lease/v1")]
    Lease,
    /// Node proof of possession at enrollment.
    #[serde(rename = "otterd/enroll-request/v1")]
    EnrollRequest,
    /// Control-plane enrollment certificate.
    #[serde(rename = "otterd/enroll/v1")]
    Enroll,
    /// Node key rotation, signed by both the old and the new identity key.
    #[serde(rename = "otterd/key-rotation/v1")]
    KeyRotation,
    /// Control-plane signing-key transition, signed by both keys.
    #[serde(rename = "otterd/cp-key-transition/v1")]
    CpKeyTransition,
    /// Node-signed positive stop certificate.
    #[serde(rename = "otterd/stop-certificate/v1")]
    StopCertificate,
    /// Recovery-root revocation of authority below a term.
    #[serde(rename = "otterd/authority-revoke/v1")]
    AuthorityRevoke,
    /// Install-admin signed platform boot manifest.
    #[serde(rename = "otterd/platform-boot-manifest/v1")]
    PlatformBootManifest,
    /// Signed release manifest pinning binaries and protocol versions.
    #[serde(rename = "otterd/release-manifest/v1")]
    ReleaseManifest,
    /// Owner-signed full endpoint snapshot.
    #[serde(rename = "otterd/owner-snapshot/v1")]
    OwnerSnapshot,
    /// Owner answer to a receiver freshness challenge.
    #[serde(rename = "otterd/challenge-answer/v1")]
    ChallengeAnswer,
    /// Control-plane serving set.
    #[serde(rename = "otterd/serving-set/v1")]
    ServingSet,
    /// Control-plane membership revision.
    #[serde(rename = "otterd/membership/v1")]
    Membership,
    /// Peer reachability answer.
    #[serde(rename = "otterd/peer-answer/v1")]
    PeerAnswer,
    /// Off-node recovery anchor records.
    #[serde(rename = "otterd/anchor/v1")]
    Anchor,
}

impl SignContext {
    /// Every context, for exhaustive fixtures.
    pub const ALL: [Self; 17] = [
        Self::Session,
        Self::Capability,
        Self::Lease,
        Self::EnrollRequest,
        Self::Enroll,
        Self::KeyRotation,
        Self::CpKeyTransition,
        Self::StopCertificate,
        Self::AuthorityRevoke,
        Self::PlatformBootManifest,
        Self::ReleaseManifest,
        Self::OwnerSnapshot,
        Self::ChallengeAnswer,
        Self::ServingSet,
        Self::Membership,
        Self::PeerAnswer,
        Self::Anchor,
    ];

    /// The exact bytes mixed into the signing input.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Session => "otterd/session/v1",
            Self::Capability => "otterd/capability/v1",
            Self::Lease => "otterd/lease/v1",
            Self::EnrollRequest => "otterd/enroll-request/v1",
            Self::Enroll => "otterd/enroll/v1",
            Self::KeyRotation => "otterd/key-rotation/v1",
            Self::CpKeyTransition => "otterd/cp-key-transition/v1",
            Self::StopCertificate => "otterd/stop-certificate/v1",
            Self::AuthorityRevoke => "otterd/authority-revoke/v1",
            Self::PlatformBootManifest => "otterd/platform-boot-manifest/v1",
            Self::ReleaseManifest => "otterd/release-manifest/v1",
            Self::OwnerSnapshot => "otterd/owner-snapshot/v1",
            Self::ChallengeAnswer => "otterd/challenge-answer/v1",
            Self::ServingSet => "otterd/serving-set/v1",
            Self::Membership => "otterd/membership/v1",
            Self::PeerAnswer => "otterd/peer-answer/v1",
            Self::Anchor => "otterd/anchor/v1",
        }
    }
}

impl fmt::Display for SignContext {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// An Ed25519 public key on the wire: standard base64 of the 32 raw bytes.
#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct PublicKey {
    encoded: String,
    key: [u8; 32],
}

impl PublicKey {
    #[must_use]
    pub fn from_bytes(key: [u8; 32]) -> Self {
        Self {
            encoded: B64.encode(key),
            key,
        }
    }

    #[must_use]
    pub fn from_verifying_key(key: &VerifyingKey) -> Self {
        Self::from_bytes(key.to_bytes())
    }

    #[must_use]
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.key
    }

    /// The Ed25519 verifier. Fails for a small-order or non-canonical point.
    pub fn verifying_key(&self) -> Result<VerifyingKey, EnvelopeError> {
        VerifyingKey::from_bytes(&self.key).map_err(|_| EnvelopeError::InvalidKey)
    }

    /// Short id of this key: hex of the first 16 bytes of SHA-256(key).
    #[must_use]
    pub fn key_id(&self) -> KeyId {
        key_id_of(&self.key)
    }
}

impl TryFrom<String> for PublicKey {
    type Error = EnvelopeError;

    fn try_from(encoded: String) -> Result<Self, Self::Error> {
        let bytes = B64
            .decode(encoded.as_bytes())
            .map_err(|_| EnvelopeError::Encoding("public key is not base64"))?;
        let key: [u8; 32] = bytes
            .try_into()
            .map_err(|_| EnvelopeError::Encoding("public key must be 32 bytes"))?;
        Ok(Self::from_bytes(key))
    }
}

impl From<PublicKey> for String {
    fn from(key: PublicKey) -> Self {
        key.encoded
    }
}

impl fmt::Debug for PublicKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "PublicKey({})", self.key_id())
    }
}

fn key_id_of(key: &[u8; 32]) -> KeyId {
    let prefix: Vec<u8> = Sha256::digest(key).iter().take(16).copied().collect();
    KeyId::from_trusted_hex(hex::encode(prefix))
}

/// Envelope failures. None of them carry the payload: a rejected document is
/// never partially trusted.
#[derive(Debug, thiserror::Error)]
pub enum EnvelopeError {
    #[error("envelope context is {got}, expected {want}")]
    Context { want: SignContext, got: SignContext },
    #[error("envelope signed by {got}, which is not a trusted key for this context")]
    UntrustedKey { got: KeyId },
    #[error("bad encoding: {0}")]
    Encoding(&'static str),
    #[error("public key is not a valid Ed25519 point")]
    InvalidKey,
    #[error("signature does not verify")]
    BadSignature,
    #[error("payload: {0}")]
    Payload(#[from] serde_json::Error),
}

/// A signed document.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignedEnvelope {
    pub context: SignContext,
    /// [`PublicKey::key_id`] of the signer.
    pub key_id: KeyId,
    /// Standard base64 of the exact signed payload bytes (UTF-8 JSON).
    pub payload: String,
    /// Standard base64 of the 64-byte Ed25519 signature.
    pub signature: String,
}

impl fmt::Debug for SignedEnvelope {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SignedEnvelope")
            .field("context", &self.context)
            .field("key_id", &self.key_id)
            .field("payload_len", &self.payload.len())
            .finish_non_exhaustive()
    }
}

/// The bytes Ed25519 signs: `context || 0x00 || payload`.
#[must_use]
pub fn signing_input(context: SignContext, payload: &[u8]) -> Vec<u8> {
    let ctx = context.as_str().as_bytes();
    let mut input = Vec::with_capacity(ctx.len() + 1 + payload.len());
    input.extend_from_slice(ctx);
    input.push(0);
    input.extend_from_slice(payload);
    input
}

impl SignedEnvelope {
    /// Serialize `value` once and sign those bytes.
    pub fn sign<T: Serialize>(
        key: &SigningKey,
        context: SignContext,
        value: &T,
    ) -> Result<Self, EnvelopeError> {
        let payload = serde_json::to_vec(value)?;
        Ok(Self::sign_bytes(key, context, &payload))
    }

    #[must_use]
    pub fn sign_bytes(key: &SigningKey, context: SignContext, payload: &[u8]) -> Self {
        let signature = key.sign(&signing_input(context, payload));
        Self {
            context,
            key_id: PublicKey::from_verifying_key(&key.verifying_key()).key_id(),
            payload: B64.encode(payload),
            signature: B64.encode(signature.to_bytes()),
        }
    }

    /// Verify against one of the `trusted` keys for `context` and return the
    /// exact payload bytes. Key rotation passes both the old and the new key.
    pub fn verify_bytes(
        &self,
        trusted: &[PublicKey],
        context: SignContext,
    ) -> Result<Vec<u8>, EnvelopeError> {
        if self.context != context {
            return Err(EnvelopeError::Context {
                want: context,
                got: self.context,
            });
        }
        let key = trusted
            .iter()
            .find(|k| k.key_id() == self.key_id)
            .ok_or_else(|| EnvelopeError::UntrustedKey {
                got: self.key_id.clone(),
            })?;
        let payload = B64
            .decode(self.payload.as_bytes())
            .map_err(|_| EnvelopeError::Encoding("payload is not base64"))?;
        let signature = B64
            .decode(self.signature.as_bytes())
            .map_err(|_| EnvelopeError::Encoding("signature is not base64"))?;
        let signature = Signature::from_slice(&signature)
            .map_err(|_| EnvelopeError::Encoding("signature must be 64 bytes"))?;
        key.verifying_key()?
            .verify_strict(&signing_input(context, &payload), &signature)
            .map_err(|_| EnvelopeError::BadSignature)?;
        Ok(payload)
    }

    /// Verify, then parse the verified bytes.
    pub fn verify<T: DeserializeOwned>(
        &self,
        trusted: &[PublicKey],
        context: SignContext,
    ) -> Result<T, EnvelopeError> {
        let bytes = self.verify_bytes(trusted, context)?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    /// Parse the payload **without verifying the signature**. Only for documents
    /// this process signed itself and already holds (for example its own stop
    /// certificate read back from its journal); never for anything received.
    pub fn decode_own_payload<T: DeserializeOwned>(&self) -> Result<T, EnvelopeError> {
        let payload = B64
            .decode(self.payload.as_bytes())
            .map_err(|_| EnvelopeError::Encoding("payload is not base64"))?;
        Ok(serde_json::from_slice(&payload)?)
    }

    /// SHA-256 of the signed payload bytes: what journals and certificates bind.
    pub fn payload_digest(&self) -> Result<Sha256Hex, EnvelopeError> {
        let payload = B64
            .decode(self.payload.as_bytes())
            .map_err(|_| EnvelopeError::Encoding("payload is not base64"))?;
        Ok(Sha256Hex::digest(&payload))
    }
}

/// Generate a fresh Ed25519 signing key from the OS RNG.
pub fn generate_signing_key() -> Result<SigningKey, getrandom::Error> {
    let mut seed = [0u8; 32];
    getrandom::fill(&mut seed)?;
    Ok(SigningKey::from_bytes(&seed))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(seed: u8) -> SigningKey {
        SigningKey::from_bytes(&[seed; 32])
    }

    fn public(k: &SigningKey) -> PublicKey {
        PublicKey::from_verifying_key(&k.verifying_key())
    }

    #[test]
    fn context_and_key_are_bound() {
        let k = key(1);
        let other = key(2);
        let env =
            SignedEnvelope::sign(&k, SignContext::Lease, &serde_json::json!({"a": 1})).unwrap();
        let v: serde_json::Value = env.verify(&[public(&k)], SignContext::Lease).unwrap();
        assert_eq!(v["a"], 1);
        assert!(matches!(
            env.verify_bytes(&[public(&k)], SignContext::Capability),
            Err(EnvelopeError::Context { .. })
        ));
        assert!(matches!(
            env.verify_bytes(&[public(&other)], SignContext::Lease),
            Err(EnvelopeError::UntrustedKey { .. })
        ));
        // Rotation: either key of a transition verifies.
        assert!(
            env.verify_bytes(&[public(&other), public(&k)], SignContext::Lease)
                .is_ok()
        );
    }

    #[test]
    fn tampering_is_detected() {
        let k = key(3);
        let env = SignedEnvelope::sign(&k, SignContext::Capability, &serde_json::json!({"a": 1}))
            .unwrap();
        let mut tampered = env.clone();
        tampered.payload = B64.encode(br#"{"a":2}"#);
        assert!(matches!(
            tampered.verify_bytes(&[public(&k)], SignContext::Capability),
            Err(EnvelopeError::BadSignature)
        ));
        // Relabelling the context breaks the signature too (domain separation).
        let mut relabelled = env;
        relabelled.context = SignContext::Lease;
        assert!(matches!(
            relabelled.verify_bytes(&[public(&k)], SignContext::Lease),
            Err(EnvelopeError::BadSignature)
        ));
    }

    #[test]
    fn signatures_are_deterministic() {
        // Ed25519 is deterministic: the TypeScript signer must produce the same bytes.
        let a = SignedEnvelope::sign_bytes(&key(9), SignContext::Session, b"hello");
        let b = SignedEnvelope::sign_bytes(&key(9), SignContext::Session, b"hello");
        assert_eq!(a, b);
    }

    #[test]
    fn contexts_round_trip_as_their_strings() {
        for ctx in SignContext::ALL {
            let json = serde_json::to_string(&ctx).unwrap();
            assert_eq!(json, format!("\"{}\"", ctx.as_str()));
            assert_eq!(serde_json::from_str::<SignContext>(&json).unwrap(), ctx);
        }
    }
}
