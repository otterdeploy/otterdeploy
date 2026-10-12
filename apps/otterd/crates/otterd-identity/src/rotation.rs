//! Signed statements about keys: node key rotation, control-plane signing-key
//! transitions, and the enrollment request.

use crate::{KeyError, NodeKeyset};
use otterd_proto::U53;
use otterd_proto::envelope::{EnvelopeError, PublicKey, SignContext, SignedEnvelope};
use otterd_proto::identity::{
    CpKeyTransition, CrossSigned, EnrollRequest, HostBinding, HostFacts, KeyRotation, NodeRole,
    TrustedKey,
};
use otterd_proto::ids::{InstallId, NodeId, Nonce};
use otterd_proto::num::UnixMs;

#[derive(Debug, thiserror::Error)]
pub enum RotationError {
    #[error(transparent)]
    Envelope(#[from] EnvelopeError),
    #[error("the two signatures cover different payloads")]
    PayloadMismatch,
    #[error("the rotation is for another install or node")]
    WrongNode,
    #[error("the rotation starts from key epoch {got}, the current epoch is {current}")]
    StaleEpoch { current: U53, got: U53 },
    #[error("the new key epoch must be {want}, got {got}")]
    EpochNotNext { want: U53, got: U53 },
    #[error("the new identity key equals the old one")]
    KeyReused,
    #[error("a key transition must be signed by the outgoing key {want}, not {got}")]
    NotSignedByOutgoing {
        want: otterd_proto::ids::KeyId,
        got: otterd_proto::ids::KeyId,
    },
    #[error("the incoming key's epoch {got} must exceed every trusted epoch (highest {have})")]
    EpochNotRaised { have: U53, got: U53 },
    #[error("no control-plane key is valid now")]
    NoValidKey,
}

/// The rotation statement for `old` → `new`, signed by both identity keys over
/// byte-identical payloads.
pub fn cross_sign(
    old: &NodeKeyset,
    new: &NodeKeyset,
    install_id: &InstallId,
    node_id: &NodeId,
    node_epoch: U53,
    reason: &str,
) -> Result<CrossSigned, KeyError> {
    if old.epoch().checked_add(1) != Some(new.epoch()) {
        return Err(KeyError::EpochGap {
            current: old.epoch(),
            requested: new.epoch(),
        });
    }
    let statement = KeyRotation {
        install_id: install_id.clone(),
        node_id: node_id.clone(),
        node_epoch,
        from_key_epoch: old.epoch(),
        new_keys: new.public(),
        reason: reason.to_owned(),
    };
    let payload = serde_json::to_vec(&statement)?;
    Ok(CrossSigned {
        by_old: SignedEnvelope::sign_bytes(old.identity(), SignContext::KeyRotation, &payload),
        by_new: SignedEnvelope::sign_bytes(new.identity(), SignContext::KeyRotation, &payload),
    })
}

/// What the verifier knows about the node before the rotation.
#[derive(Debug, Clone, Copy)]
pub struct Enrolled<'a> {
    pub install_id: &'a InstallId,
    pub node_id: &'a NodeId,
    pub identity: &'a PublicKey,
    pub key_epoch: U53,
}

/// Verify a rotation statement: the outgoing key the verifier already trusts
/// signed it, the incoming key it names signed the same bytes (proof of
/// possession), and it moves exactly one epoch forward.
pub fn verify_rotation(
    statement: &CrossSigned,
    enrolled: Enrolled<'_>,
) -> Result<KeyRotation, RotationError> {
    let old_bytes = statement.by_old.verify_bytes(
        std::slice::from_ref(enrolled.identity),
        SignContext::KeyRotation,
    )?;
    let rotation: KeyRotation = serde_json::from_slice(&old_bytes).map_err(EnvelopeError::from)?;
    let new_bytes = statement.by_new.verify_bytes(
        std::slice::from_ref(&rotation.new_keys.identity),
        SignContext::KeyRotation,
    )?;
    if old_bytes != new_bytes {
        return Err(RotationError::PayloadMismatch);
    }
    if &rotation.install_id != enrolled.install_id || &rotation.node_id != enrolled.node_id {
        return Err(RotationError::WrongNode);
    }
    if rotation.from_key_epoch != enrolled.key_epoch {
        return Err(RotationError::StaleEpoch {
            current: enrolled.key_epoch,
            got: rotation.from_key_epoch,
        });
    }
    let want = enrolled.key_epoch.saturating_add(1);
    if rotation.new_keys.key_epoch != want {
        return Err(RotationError::EpochNotNext {
            want,
            got: rotation.new_keys.key_epoch,
        });
    }
    if &rotation.new_keys.identity == enrolled.identity {
        return Err(RotationError::KeyReused);
    }
    Ok(rotation)
}

/// Control-plane keys that verify signatures at `now`.
#[must_use]
pub fn valid_cp_keys(trusted: &[TrustedKey], now: UnixMs) -> Vec<PublicKey> {
    trusted
        .iter()
        .filter(|k| k.not_after_unix_ms.is_none_or(|t| now < t))
        .map(|k| k.key.clone())
        .collect()
}

/// Apply a control-plane signing-key transition. It must be signed by the
/// outgoing key while that key is still valid; the incoming key is added with
/// a higher epoch, the outgoing key stays valid only until
/// `oldValidUntilUnixMs`, and keys already past their validity are dropped.
pub fn apply_cp_transition(
    trusted: &[TrustedKey],
    transition: &SignedEnvelope,
    install_id: &InstallId,
    now: UnixMs,
) -> Result<Vec<TrustedKey>, RotationError> {
    let valid = valid_cp_keys(trusted, now);
    if valid.is_empty() {
        return Err(RotationError::NoValidKey);
    }
    let t: CpKeyTransition = transition.verify(&valid, SignContext::CpKeyTransition)?;
    if &t.install_id != install_id {
        return Err(RotationError::WrongNode);
    }
    if transition.key_id != t.from_key_id {
        return Err(RotationError::NotSignedByOutgoing {
            want: t.from_key_id,
            got: transition.key_id.clone(),
        });
    }
    let have = trusted.iter().map(|k| k.epoch).max().unwrap_or(U53::ZERO);
    if t.to.epoch <= have {
        return Err(RotationError::EpochNotRaised {
            have,
            got: t.to.epoch,
        });
    }
    let mut out: Vec<TrustedKey> = trusted
        .iter()
        .filter(|k| k.not_after_unix_ms.is_none_or(|end| now < end))
        .map(|k| {
            let mut k = k.clone();
            if k.key.key_id() == t.from_key_id {
                k.not_after_unix_ms = Some(
                    k.not_after_unix_ms
                        .map_or(t.old_valid_until_unix_ms, |end| {
                            end.min(t.old_valid_until_unix_ms)
                        }),
                );
            }
            k
        })
        .collect();
    out.push(t.to);
    Ok(out)
}

/// The enrollment request, signed by the new identity key so the control
/// plane binds the single-use token to exactly these keys.
pub fn enroll_request(
    keys: &NodeKeyset,
    token: &str,
    host: HostBinding,
    facts: HostFacts,
    requested_roles: Vec<NodeRole>,
    otterd_version: &str,
) -> Result<SignedEnvelope, KeyError> {
    let request = EnrollRequest {
        token: token.to_owned(),
        nonce: Nonce::random().map_err(|e| KeyError::Random(e.to_string()))?,
        keys: keys.public(),
        host,
        facts,
        requested_roles,
        otterd_version: otterd_version.to_owned(),
    };
    Ok(SignedEnvelope::sign(
        keys.identity(),
        SignContext::EnrollRequest,
        &request,
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;

    fn ids() -> (InstallId, NodeId) {
        ("inst".parse().unwrap(), "node-1".parse().unwrap())
    }

    #[test]
    fn a_rotation_verifies_only_as_signed() {
        let (inst, node) = ids();
        let one = NodeKeyset::generate(U53::ONE).unwrap();
        let two = NodeKeyset::generate(U53::from_const(2)).unwrap();
        let cs = cross_sign(&one, &two, &inst, &node, U53::ONE, "scheduled").unwrap();
        let id1 = one.identity_public();
        let enrolled = Enrolled {
            install_id: &inst,
            node_id: &node,
            identity: &id1,
            key_epoch: U53::ONE,
        };
        let r = verify_rotation(&cs, enrolled).unwrap();
        assert_eq!(r.new_keys, two.public());

        // Already at epoch 2: replaying the statement is stale.
        let id2 = two.identity_public();
        let after = Enrolled {
            identity: &id2,
            key_epoch: U53::from_const(2),
            ..enrolled
        };
        assert!(verify_rotation(&cs, after).is_err());

        // A new key that did not sign: swap in a signature by some other key.
        let three = NodeKeyset::generate(U53::from_const(2)).unwrap();
        let forged = CrossSigned {
            by_old: cs.by_old.clone(),
            by_new: cross_sign(&one, &three, &inst, &node, U53::ONE, "scheduled")
                .unwrap()
                .by_new,
        };
        assert!(matches!(
            verify_rotation(&forged, enrolled),
            Err(RotationError::Envelope(EnvelopeError::UntrustedKey { .. }))
        ));

        // Signed by a key the verifier never trusted.
        let stranger = NodeKeyset::generate(U53::ONE).unwrap();
        let cs2 = cross_sign(&stranger, &two, &inst, &node, U53::ONE, "x").unwrap();
        assert!(verify_rotation(&cs2, enrolled).is_err());

        // Another node.
        let other: NodeId = "node-2".parse().unwrap();
        let cs3 = cross_sign(&one, &two, &inst, &other, U53::ONE, "x").unwrap();
        assert!(matches!(
            verify_rotation(&cs3, enrolled),
            Err(RotationError::WrongNode)
        ));
        assert!(cross_sign(&one, &three, &inst, &node, U53::ONE, "x").is_ok());
        assert!(cross_sign(&two, &one, &inst, &node, U53::ONE, "x").is_err());
    }

    fn cp(seed: u8, epoch: u64, not_after: Option<u64>) -> (SigningKey, TrustedKey) {
        let k = SigningKey::from_bytes(&[seed; 32]);
        let t = TrustedKey {
            key: PublicKey::from_verifying_key(&k.verifying_key()),
            epoch: U53::from_const(epoch),
            not_after_unix_ms: not_after.map(U53::from_const),
        };
        (k, t)
    }

    #[test]
    fn cp_key_transitions_overlap_then_expire() {
        let (inst, _) = ids();
        let (old_key, old) = cp(1, 1, None);
        let (new_key, new) = cp(2, 2, None);
        let t = CpKeyTransition {
            install_id: inst.clone(),
            from_key_id: old.key.key_id(),
            to: new.clone(),
            old_valid_until_unix_ms: U53::from_const(2_000),
        };
        let env = SignedEnvelope::sign(&old_key, SignContext::CpKeyTransition, &t).unwrap();
        let keys = apply_cp_transition(
            std::slice::from_ref(&old),
            &env,
            &inst,
            U53::from_const(1_000),
        )
        .unwrap();
        assert_eq!(keys.len(), 2);
        assert_eq!(valid_cp_keys(&keys, U53::from_const(1_500)).len(), 2);
        assert_eq!(
            valid_cp_keys(&keys, U53::from_const(2_000)),
            vec![new.key.clone()]
        );
        // Replaying it does not raise the epoch again.
        assert!(matches!(
            apply_cp_transition(&keys, &env, &inst, U53::from_const(1_500)),
            Err(RotationError::EpochNotRaised { .. })
        ));
        // Signed by the incoming key itself: refused.
        let self_signed = SignedEnvelope::sign(&new_key, SignContext::CpKeyTransition, &t).unwrap();
        let with_new = [old.clone(), new.clone()];
        assert!(matches!(
            apply_cp_transition(&with_new, &self_signed, &inst, U53::from_const(1_000)),
            Err(RotationError::NotSignedByOutgoing { .. } | RotationError::EpochNotRaised { .. })
        ));
        // Too late: the outgoing key had already expired.
        let (_, expired) = cp(1, 1, Some(500));
        assert!(apply_cp_transition(&[expired], &env, &inst, U53::from_const(1_000)).is_err());
    }

    #[test]
    fn the_enroll_request_proves_possession() {
        let keys = NodeKeyset::generate(U53::ONE).unwrap();
        let host = HostBinding {
            machine_id: "m".into(),
            product_uuid: None,
            provider: None,
        };
        let facts: HostFacts = serde_json::from_value(serde_json::json!({
            "hostname": "h", "arch": "x86_64", "osId": "ubuntu", "osVersion": "24.04",
            "kernel": "6.8", "cpuCores": 2, "memoryBytes": 1024
        }))
        .unwrap();
        let env =
            enroll_request(&keys, "tok", host, facts, vec![NodeRole::Worker], "0.1.0").unwrap();
        let req: EnrollRequest = env
            .verify(&[keys.identity_public()], SignContext::EnrollRequest)
            .unwrap();
        assert_eq!((req.token.as_str(), req.keys), ("tok", keys.public()));
    }
}
