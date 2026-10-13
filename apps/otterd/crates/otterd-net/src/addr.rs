//! IPv4 prefix arithmetic used by the address plan and the policy renderer.
//!
//! Only what the network layer needs: a canonical prefix type, containment,
//! overlap, aligned sub-prefix enumeration and nftables-friendly display.

use std::fmt;
use std::net::Ipv4Addr;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

/// A canonical IPv4 prefix: the host bits of `addr` are always zero.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Ipv4Net {
    addr: Ipv4Addr,
    len: u8,
}

/// Why a prefix could not be built or parsed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PrefixError {
    /// The prefix length is above 32.
    #[error("prefix length {0} is above 32")]
    Length(u8),
    /// The address has bits set below the prefix length.
    #[error("{addr}/{len} has host bits set (did you mean {canonical}?)")]
    HostBits {
        /// Address as given.
        addr: Ipv4Addr,
        /// Prefix length as given.
        len: u8,
        /// The canonical network for that length.
        canonical: Ipv4Net,
    },
    /// The text is not `a.b.c.d/len`.
    #[error("{0:?} is not an IPv4 prefix (a.b.c.d/len)")]
    Syntax(String),
}

const fn mask(len: u8) -> u32 {
    if len == 0 {
        0
    } else {
        u32::MAX << (32 - len as u32)
    }
}

impl Ipv4Net {
    /// Builds a prefix, refusing host bits so a typo cannot silently widen a range.
    ///
    /// # Errors
    /// [`PrefixError::Length`] above /32, [`PrefixError::HostBits`] if `addr` is not the network address.
    pub fn new(addr: Ipv4Addr, len: u8) -> Result<Self, PrefixError> {
        if len > 32 {
            return Err(PrefixError::Length(len));
        }
        let canonical = Self::truncate(addr, len);
        if canonical.addr != addr {
            return Err(PrefixError::HostBits {
                addr,
                len,
                canonical,
            });
        }
        Ok(canonical)
    }

    /// The prefix of length `len` that contains `addr` (host bits cleared).
    ///
    /// # Panics
    /// Never for `len <= 32`; larger values are clamped to 32.
    #[must_use]
    pub fn truncate(addr: Ipv4Addr, len: u8) -> Self {
        let len = len.min(32);
        Self {
            addr: Ipv4Addr::from(u32::from(addr) & mask(len)),
            len,
        }
    }

    /// Network address.
    #[must_use]
    pub const fn addr(&self) -> Ipv4Addr {
        self.addr
    }

    /// Prefix length.
    #[must_use]
    pub const fn prefix_len(&self) -> u8 {
        self.len
    }

    /// Number of addresses covered.
    #[must_use]
    pub const fn size(&self) -> u64 {
        1u64 << (32 - self.len as u32)
    }

    /// Last address covered.
    #[must_use]
    pub fn last(&self) -> Ipv4Addr {
        Ipv4Addr::from(u32::from(self.addr) | !mask(self.len))
    }

    /// Whether `ip` is inside this prefix.
    #[must_use]
    pub fn contains(&self, ip: Ipv4Addr) -> bool {
        u32::from(ip) & mask(self.len) == u32::from(self.addr)
    }

    /// Whether `other` lies entirely inside this prefix.
    #[must_use]
    pub fn covers(&self, other: &Self) -> bool {
        other.len >= self.len && self.contains(other.addr)
    }

    /// Whether the two prefixes share any address. Prefixes either nest or are disjoint.
    #[must_use]
    pub fn overlaps(&self, other: &Self) -> bool {
        self.covers(other) || other.covers(self)
    }

    /// The `index`-th aligned sub-prefix of length `len`, if it exists.
    #[must_use]
    pub fn subnet(&self, len: u8, index: u32) -> Option<Self> {
        if len < self.len || len > 32 {
            return None;
        }
        let count = 1u64 << (len - self.len);
        if u64::from(index) >= count {
            return None;
        }
        let step = 1u64 << (32 - u32::from(len));
        let base = u64::from(u32::from(self.addr)) + u64::from(index) * step;
        let base = u32::try_from(base).ok()?;
        Some(Self {
            addr: Ipv4Addr::from(base),
            len,
        })
    }

    /// How many aligned sub-prefixes of length `len` this prefix holds (0 if `len` is shorter).
    #[must_use]
    pub fn subnet_count(&self, len: u8) -> u64 {
        if len < self.len || len > 32 {
            0
        } else {
            1u64 << (len - self.len)
        }
    }

    /// Index of `inner` among this prefix's aligned sub-prefixes of `inner`'s length.
    #[must_use]
    pub fn index_of(&self, inner: &Self) -> Option<u32> {
        if !self.covers(inner) {
            return None;
        }
        let offset = u32::from(inner.addr) - u32::from(self.addr);
        Some(offset >> (32 - u32::from(inner.len)))
    }

    /// The `n`-th host address (0 is the network address).
    #[must_use]
    pub fn host(&self, n: u32) -> Option<Ipv4Addr> {
        if u64::from(n) >= self.size() {
            return None;
        }
        Some(Ipv4Addr::from(u32::from(self.addr) + n))
    }
}

impl fmt::Display for Ipv4Net {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}/{}", self.addr, self.len)
    }
}

impl FromStr for Ipv4Net {
    type Err = PrefixError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let (a, l) = s
            .split_once('/')
            .ok_or_else(|| PrefixError::Syntax(s.to_owned()))?;
        let addr = a.parse().map_err(|_| PrefixError::Syntax(s.to_owned()))?;
        let len = l.parse().map_err(|_| PrefixError::Syntax(s.to_owned()))?;
        Self::new(addr, len)
    }
}

impl TryFrom<String> for Ipv4Net {
    type Error = PrefixError;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        s.parse()
    }
}

impl From<Ipv4Net> for String {
    fn from(n: Ipv4Net) -> Self {
        n.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn net(s: &str) -> Ipv4Net {
        s.parse().unwrap()
    }

    #[test]
    fn parse_refuses_host_bits_and_suggests_the_network() {
        let err = "172.24.0.5/13".parse::<Ipv4Net>().unwrap_err();
        assert_eq!(
            err,
            PrefixError::HostBits {
                addr: Ipv4Addr::new(172, 24, 0, 5),
                len: 13,
                canonical: net("172.24.0.0/13")
            }
        );
        assert!("172.24.0.0/33".parse::<Ipv4Net>().is_err());
        assert!("172.24.0.0".parse::<Ipv4Net>().is_err());
    }

    #[test]
    fn a_slash_13_holds_64_slash_19_slices_of_256_slash_27_scopes() {
        let sup = net("172.24.0.0/13");
        assert_eq!(sup.subnet_count(19), 64);
        assert_eq!(sup.subnet(19, 1), Some(net("172.24.32.0/19")));
        assert_eq!(sup.subnet(19, 63), Some(net("172.31.224.0/19")));
        assert_eq!(sup.subnet(19, 64), None);
        assert_eq!(net("172.24.32.0/19").subnet_count(27), 256);
        assert_eq!(
            net("172.24.32.0/19").subnet(27, 2),
            Some(net("172.24.32.64/27"))
        );
        assert_eq!(sup.last(), Ipv4Addr::new(172, 31, 255, 255));
    }

    #[test]
    fn index_of_inverts_subnet() {
        let s = net("172.24.32.0/19");
        assert_eq!(s.index_of(&net("172.24.33.0/27")), Some(8));
        assert_eq!(s.index_of(&net("172.25.0.0/27")), None);
    }

    proptest! {
        #[test]
        fn subnets_are_disjoint_covered_and_indexed(base in any::<u32>(), outer in 8u8..=28, extra in 0u8..=4, i in 0u32..16, j in 0u32..16) {
            let outer_net = Ipv4Net::truncate(Ipv4Addr::from(base), outer);
            let inner = (outer + extra).min(32);
            let (Some(a), Some(b)) = (outer_net.subnet(inner, i), outer_net.subnet(inner, j)) else { return Ok(()) };
            prop_assert!(outer_net.covers(&a));
            prop_assert_eq!(outer_net.index_of(&a), Some(i));
            prop_assert_eq!(a.overlaps(&b), i == j);
        }

        #[test]
        fn display_round_trips(base in any::<u32>(), len in 0u8..=32) {
            let n = Ipv4Net::truncate(Ipv4Addr::from(base), len);
            prop_assert_eq!(n.to_string().parse::<Ipv4Net>(), Ok(n));
        }
    }
}
