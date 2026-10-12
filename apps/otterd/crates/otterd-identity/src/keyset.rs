//! One key epoch's private keys.

use crate::KeyError;
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;
use ed25519_dalek::SigningKey;
use otterd_proto::U53;
use otterd_proto::envelope::PublicKey;
use otterd_proto::identity::NodeKeys;
use std::fmt;
use x25519_dalek::StaticSecret;
use zeroize::Zeroizing;

/// The private keys of one key epoch. `Debug` prints public key ids only; the
/// secrets are wiped when the set is dropped.
pub struct NodeKeyset {
    epoch: U53,
    identity: SigningKey,
    cache: StaticSecret,
    wireguard: StaticSecret,
}

impl fmt::Debug for NodeKeyset {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("NodeKeyset")
            .field("epoch", &self.epoch)
            .field("identity", &self.identity_public().key_id())
            .finish_non_exhaustive()
    }
}

/// Curve25519 clamping, as `wg genkey` does: the stored WireGuard key is then
/// byte-identical to what WireGuard itself would generate and use.
fn clamp(mut b: [u8; 32]) -> [u8; 32] {
    b[0] &= 0b1111_1000;
    b[31] &= 0b0111_1111;
    b[31] |= 0b0100_0000;
    b
}

fn random32() -> Result<Zeroizing<[u8; 32]>, KeyError> {
    let mut b = Zeroizing::new([0u8; 32]);
    getrandom::fill(b.as_mut_slice()).map_err(|e| KeyError::Random(e.to_string()))?;
    Ok(b)
}

impl NodeKeyset {
    /// Fresh keys for `epoch` from the OS random source.
    pub fn generate(epoch: U53) -> Result<Self, KeyError> {
        Ok(Self::from_secrets(
            epoch,
            &*random32()?,
            &*random32()?,
            &*random32()?,
        ))
    }

    pub(crate) fn from_secrets(
        epoch: U53,
        identity: &[u8; 32],
        cache: &[u8; 32],
        wireguard: &[u8; 32],
    ) -> Self {
        Self {
            epoch,
            identity: SigningKey::from_bytes(identity),
            cache: StaticSecret::from(clamp(*cache)),
            wireguard: StaticSecret::from(clamp(*wireguard)),
        }
    }

    pub(crate) fn secrets(&self) -> [(&'static str, Zeroizing<[u8; 32]>); 3] {
        [
            ("identity", Zeroizing::new(self.identity.to_bytes())),
            ("cache", Zeroizing::new(self.cache.to_bytes())),
            ("wireguard", Zeroizing::new(self.wireguard.to_bytes())),
        ]
    }

    #[must_use]
    pub fn epoch(&self) -> U53 {
        self.epoch
    }

    #[must_use]
    pub fn identity(&self) -> &SigningKey {
        &self.identity
    }

    #[must_use]
    pub fn identity_public(&self) -> PublicKey {
        PublicKey::from_verifying_key(&self.identity.verifying_key())
    }

    /// The public halves, as enrollment and rotation carry them.
    #[must_use]
    pub fn public(&self) -> NodeKeys {
        NodeKeys {
            key_epoch: self.epoch,
            identity: self.identity_public(),
            cache_encryption: PublicKey::from_bytes(
                x25519_dalek::PublicKey::from(&self.cache).to_bytes(),
            ),
            wireguard: PublicKey::from_bytes(
                x25519_dalek::PublicKey::from(&self.wireguard).to_bytes(),
            ),
        }
    }

    /// The WireGuard private key in WireGuard's own text form (base64), for
    /// `wg set <if> private-key` or a netlink configuration.
    #[must_use]
    pub fn wireguard_private(&self) -> Zeroizing<String> {
        Zeroizing::new(B64.encode(self.wireguard.to_bytes()))
    }

    /// X25519 agreement with `peer` for cache encryption. `None` when the
    /// peer key is a low-order point, which would give a predictable secret.
    #[must_use]
    pub fn cache_agreement(&self, peer: &PublicKey) -> Option<Zeroizing<[u8; 32]>> {
        let shared = self
            .cache
            .diffie_hellman(&x25519_dalek::PublicKey::from(*peer.as_bytes()));
        shared
            .was_contributory()
            .then(|| Zeroizing::new(shared.to_bytes()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_are_distinct_clamped_and_agree() {
        let a = NodeKeyset::generate(U53::ONE).unwrap();
        let b = NodeKeyset::generate(U53::ONE).unwrap();
        let pa = a.public();
        assert_ne!(pa.identity, pa.cache_encryption);
        assert_ne!(pa.cache_encryption, pa.wireguard);
        assert_ne!(pa.identity, b.public().identity);
        let wg = B64.decode(a.wireguard_private().as_bytes()).unwrap();
        assert_eq!(
            (wg[0] & 7, wg[31] & 0xc0),
            (0, 0x40),
            "clamped like wg genkey"
        );
        let ab = a.cache_agreement(&b.public().cache_encryption).unwrap();
        let ba = b.cache_agreement(&pa.cache_encryption).unwrap();
        assert_eq!(*ab, *ba);
        assert!(
            a.cache_agreement(&PublicKey::from_bytes([0; 32])).is_none(),
            "a low-order peer key gives no secret"
        );
        assert!(!format!("{a:?}").contains(&*a.wireguard_private()));
    }

    #[test]
    fn rebuilding_from_secrets_gives_the_same_public_keys() {
        let original = NodeKeyset::generate(U53::from_const(4)).unwrap();
        let [(_, identity), (_, cache), (_, wireguard)] = original.secrets();
        let rebuilt = NodeKeyset::from_secrets(original.epoch(), &identity, &cache, &wireguard);
        assert_eq!(original.public(), rebuilt.public());
    }
}
