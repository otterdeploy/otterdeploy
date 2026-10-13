//! The control-channel handshake, as pure functions over frames.

use ed25519_dalek::SigningKey;
use otterd_identity::rotation::valid_cp_keys;
use otterd_proto::U53;
use otterd_proto::channel::{ChannelKind, Hello, Reject, SessionProof, SessionRole, Welcome};
use otterd_proto::envelope::{EnvelopeError, SignContext, SignedEnvelope};
use otterd_proto::identity::{HostFacts, TrustedKey};
use otterd_proto::ids::{BootId, Incarnation, InstallId, NodeId, Nonce, SessionId};
use otterd_proto::version::{Feature, JOURNAL_FORMAT, VersionRange};
use std::fmt;

/// Everything the node presents about itself. Re-read before every
/// connection: keys, epochs and the trusted control-plane keys change.
#[derive(Clone)]
pub struct NodeIdentity {
    pub install_id: InstallId,
    pub node_id: NodeId,
    pub node_epoch: U53,
    pub key_epoch: U53,
    pub signing: SigningKey,
    pub boot_id: BootId,
    pub incarnation: Incarnation,
    pub cp_keys: Vec<TrustedKey>,
    pub otterd_version: String,
    pub features: Vec<Feature>,
    pub facts: Option<HostFacts>,
}

impl fmt::Debug for NodeIdentity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("NodeIdentity")
            .field("node_id", &self.node_id)
            .field("node_epoch", &self.node_epoch)
            .field("key_epoch", &self.key_epoch)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum HandshakeError {
    #[error("rejected ({:?}): {}", .0.code, .0.message)]
    Rejected(Reject),
    #[error("expected {expected}, got {got}")]
    Unexpected {
        expected: &'static str,
        got: &'static str,
    },
    #[error("control plane chose protocol {0}, which this node does not speak")]
    Protocol(u16),
    #[error("control plane session proof: {0}")]
    Proof(#[from] EnvelopeError),
    #[error("control plane session proof does not match this session: {0}")]
    ProofMismatch(&'static str),
    #[error("control plane enabled feature {0:?}, which this node did not offer")]
    Feature(Feature),
}

impl NodeIdentity {
    #[must_use]
    pub fn hello(&self, channel: ChannelKind, node_nonce: Nonce) -> Hello {
        Hello {
            protocol: VersionRange::CURRENT,
            channel,
            install_id: self.install_id.clone(),
            node_id: self.node_id.clone(),
            node_epoch: self.node_epoch,
            key_epoch: self.key_epoch,
            identity_key_id: otterd_proto::envelope::PublicKey::from_verifying_key(
                &self.signing.verifying_key(),
            )
            .key_id(),
            boot_id: self.boot_id.clone(),
            incarnation: self.incarnation.clone(),
            otterd_version: self.otterd_version.clone(),
            journal_format: JOURNAL_FORMAT,
            features: self.features.clone(),
            node_nonce,
            control_session_id: None,
            facts: match channel {
                ChannelKind::Control => self.facts.clone(),
                ChannelKind::Bulk => None,
            },
        }
    }

    fn proof(
        &self,
        role: SessionRole,
        channel: ChannelKind,
        welcome: &Welcome,
        node_nonce: &Nonce,
    ) -> SessionProof {
        SessionProof {
            role,
            channel,
            protocol: welcome.protocol,
            install_id: self.install_id.clone(),
            session_id: welcome.session_id.clone(),
            node_id: self.node_id.clone(),
            node_epoch: self.node_epoch,
            boot_id: self.boot_id.clone(),
            incarnation: self.incarnation.clone(),
            node_nonce: node_nonce.clone(),
            cp_nonce: welcome.cp_nonce.clone(),
        }
    }

    /// Verify the control plane's `welcome`: a protocol this node speaks, only
    /// features it offered, and a hub proof signed by a control-plane key that
    /// is valid at `at_unix_ms`, binding exactly this session, node,
    /// incarnation and both nonces.
    pub fn verify_welcome(
        &self,
        channel: ChannelKind,
        node_nonce: &Nonce,
        welcome: &Welcome,
        at_unix_ms: U53,
    ) -> Result<(), HandshakeError> {
        if !VersionRange::CURRENT.contains(welcome.protocol) {
            return Err(HandshakeError::Protocol(welcome.protocol));
        }
        if let Some(f) = welcome.features.iter().find(|f| !self.features.contains(f)) {
            return Err(HandshakeError::Feature(*f));
        }
        let keys = valid_cp_keys(&self.cp_keys, at_unix_ms);
        let proof: SessionProof = welcome.hub_proof.verify(&keys, SignContext::Session)?;
        let expected = self.proof(SessionRole::Hub, channel, welcome, node_nonce);
        if proof.role != SessionRole::Hub {
            return Err(HandshakeError::ProofMismatch("role"));
        }
        if proof.node_nonce != expected.node_nonce {
            return Err(HandshakeError::ProofMismatch("node nonce"));
        }
        if proof != expected {
            return Err(HandshakeError::ProofMismatch(
                "session, node, incarnation or channel",
            ));
        }
        Ok(())
    }

    /// The node's own proof for `authenticate`.
    pub fn node_proof(
        &self,
        channel: ChannelKind,
        welcome: &Welcome,
        node_nonce: &Nonce,
    ) -> Result<SignedEnvelope, EnvelopeError> {
        SignedEnvelope::sign(
            &self.signing,
            SignContext::Session,
            &self.proof(SessionRole::Node, channel, welcome, node_nonce),
        )
    }
}

/// What a completed handshake established.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Established {
    pub session_id: SessionId,
    pub protocol: u16,
    pub authority_term: U53,
    pub features: Vec<Feature>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use otterd_proto::channel::ChannelLimits;
    use otterd_proto::envelope::PublicKey;

    fn identity(cp: &SigningKey) -> NodeIdentity {
        NodeIdentity {
            install_id: "inst".parse().unwrap(),
            node_id: "node-1".parse().unwrap(),
            node_epoch: U53::ONE,
            key_epoch: U53::ONE,
            signing: SigningKey::from_bytes(&[2; 32]),
            boot_id: "4c1d1b7e-1d8a-4f0b-9d3e-000000000001".parse().unwrap(),
            incarnation: Incarnation::mint().unwrap(),
            cp_keys: vec![TrustedKey {
                key: PublicKey::from_verifying_key(&cp.verifying_key()),
                epoch: U53::ONE,
                not_after_unix_ms: Some(U53::from_const(10_000)),
            }],
            otterd_version: "0.1.0".into(),
            features: vec![Feature::Bulk, Feature::KeyRotation],
            facts: None,
        }
    }

    fn welcome(id: &NodeIdentity, cp: &SigningKey, nonce: &Nonce) -> Welcome {
        let mut w = Welcome {
            protocol: 1,
            session_id: "sess-1".parse().unwrap(),
            cp_nonce: Nonce::random().unwrap(),
            authority_term: U53::from_const(4),
            cp_unix_ms: U53::from_const(5_000),
            limits: ChannelLimits::DEFAULT,
            features: vec![Feature::Bulk],
            hub_proof: SignedEnvelope::sign_bytes(cp, SignContext::Session, b"{}"),
        };
        w.hub_proof = SignedEnvelope::sign(
            cp,
            SignContext::Session,
            &id.proof(SessionRole::Hub, ChannelKind::Control, &w, nonce),
        )
        .unwrap();
        w
    }

    #[test]
    fn welcome_must_bind_this_session_and_be_signed_by_a_valid_key() {
        let cp = SigningKey::from_bytes(&[1; 32]);
        let id = identity(&cp);
        let nonce = Nonce::random().unwrap();
        let w = welcome(&id, &cp, &nonce);
        let at = U53::from_const(5_000);
        id.verify_welcome(ChannelKind::Control, &nonce, &w, at)
            .unwrap();

        // A replayed welcome from another handshake: our nonce differs.
        let other = Nonce::random().unwrap();
        assert!(matches!(
            id.verify_welcome(ChannelKind::Control, &other, &w, at),
            Err(HandshakeError::ProofMismatch("node nonce"))
        ));
        // A proof for the bulk channel presented on control.
        assert!(
            id.verify_welcome(ChannelKind::Bulk, &nonce, &w, at)
                .is_err()
        );
        // The session id was swapped after signing.
        let mut swapped = w.clone();
        swapped.session_id = "sess-2".parse().unwrap();
        assert!(
            id.verify_welcome(ChannelKind::Control, &nonce, &swapped, at)
                .is_err()
        );
        // The CP key expired.
        assert!(matches!(
            id.verify_welcome(ChannelKind::Control, &nonce, &w, U53::from_const(10_000)),
            Err(HandshakeError::Proof(EnvelopeError::UntrustedKey { .. }))
        ));
        // Signed by someone else.
        let stranger = SigningKey::from_bytes(&[3; 32]);
        assert!(
            id.verify_welcome(
                ChannelKind::Control,
                &nonce,
                &welcome(&id, &stranger, &nonce),
                at
            )
            .is_err()
        );
        // A feature the node never offered; an unknown protocol.
        let mut feat = w.clone();
        feat.features.push(Feature::ProbeExecutor);
        assert!(matches!(
            id.verify_welcome(ChannelKind::Control, &nonce, &feat, at),
            Err(HandshakeError::Feature(Feature::ProbeExecutor))
        ));
        let mut proto = w;
        proto.protocol = 99;
        assert!(matches!(
            id.verify_welcome(ChannelKind::Control, &nonce, &proto, at),
            Err(HandshakeError::Protocol(99))
        ));
    }

    #[test]
    fn the_node_proof_verifies_with_the_identity_key() {
        let cp = SigningKey::from_bytes(&[1; 32]);
        let id = identity(&cp);
        let nonce = Nonce::random().unwrap();
        let w = welcome(&id, &cp, &nonce);
        let proof: SessionProof = id
            .node_proof(ChannelKind::Control, &w, &nonce)
            .unwrap()
            .verify(
                &[PublicKey::from_verifying_key(&id.signing.verifying_key())],
                SignContext::Session,
            )
            .unwrap();
        assert_eq!(proof.role, SessionRole::Node);
        assert_eq!(proof.cp_nonce, w.cp_nonce);
    }
}
