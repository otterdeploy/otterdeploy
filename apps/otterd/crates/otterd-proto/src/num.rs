//! Integers that survive a JSON round trip through the control plane.
//!
//! The control plane parses every frame in TypeScript, where a JSON number is an
//! IEEE double. A counter above 2^53 − 1 would silently lose precision there, so
//! every epoch, term, generation, sequence number, byte count and timestamp on the
//! wire is a [`U53`]: rejected on decode, unrepresentable on encode.

use serde::{Deserialize, Serialize};
use std::fmt;

/// Largest integer both sides represent exactly (`Number.MAX_SAFE_INTEGER`).
pub const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

/// A non-negative integer no larger than [`MAX_SAFE_INTEGER`].
#[derive(Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "u64", into = "u64")]
pub struct U53(u64);

/// The value does not fit in [`U53`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[error("{0} exceeds the largest JSON-safe integer {MAX_SAFE_INTEGER}")]
pub struct OutOfRange(pub u64);

impl U53 {
    pub const ZERO: Self = Self(0);
    pub const ONE: Self = Self(1);
    pub const MAX: Self = Self(MAX_SAFE_INTEGER);

    /// `None` when `value` is above [`MAX_SAFE_INTEGER`].
    #[must_use]
    pub const fn new(value: u64) -> Option<Self> {
        if value <= MAX_SAFE_INTEGER {
            Some(Self(value))
        } else {
            None
        }
    }

    /// Construct from a value known at compile time to be in range.
    ///
    /// Out-of-range constants clamp to [`U53::MAX`] rather than panic; use
    /// [`U53::new`] for anything that is not a literal.
    #[must_use]
    pub const fn from_const(value: u64) -> Self {
        if value <= MAX_SAFE_INTEGER {
            Self(value)
        } else {
            Self::MAX
        }
    }

    #[must_use]
    pub const fn get(self) -> u64 {
        self.0
    }

    #[must_use]
    pub fn checked_add(self, rhs: u64) -> Option<Self> {
        self.0.checked_add(rhs).and_then(Self::new)
    }

    #[must_use]
    pub fn checked_sub(self, rhs: u64) -> Option<Self> {
        self.0.checked_sub(rhs).map(Self)
    }

    #[must_use]
    pub fn saturating_add(self, rhs: u64) -> Self {
        Self::new(self.0.saturating_add(rhs)).unwrap_or(Self::MAX)
    }

    #[must_use]
    pub fn saturating_sub(self, rhs: u64) -> Self {
        Self(self.0.saturating_sub(rhs))
    }

    /// The successor, for monotonic counters. `None` at [`U53::MAX`].
    #[must_use]
    pub fn next(self) -> Option<Self> {
        self.checked_add(1)
    }
}

impl TryFrom<u64> for U53 {
    type Error = OutOfRange;

    fn try_from(value: u64) -> Result<Self, Self::Error> {
        Self::new(value).ok_or(OutOfRange(value))
    }
}

impl From<U53> for u64 {
    fn from(value: U53) -> Self {
        value.0
    }
}

impl From<u32> for U53 {
    fn from(value: u32) -> Self {
        Self(u64::from(value))
    }
}

impl From<u16> for U53 {
    fn from(value: u16) -> Self {
        Self(u64::from(value))
    }
}

impl fmt::Display for U53 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&self.0, f)
    }
}

impl fmt::Debug for U53 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Debug::fmt(&self.0, f)
    }
}

/// Milliseconds since the Unix epoch, as reported by a wall clock.
///
/// Wall time is evidence for humans and for bounded validity windows; it never
/// orders authority. Ordering comes from epochs, terms and sequence numbers.
pub type UnixMs = U53;

/// A duration in milliseconds.
pub type DurationMs = U53;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_values_a_double_cannot_hold() {
        assert!(U53::new(MAX_SAFE_INTEGER).is_some());
        assert!(U53::new(MAX_SAFE_INTEGER + 1).is_none());
        let err = serde_json::from_str::<U53>("9007199254740992").unwrap_err();
        assert!(err.to_string().contains("exceeds"));
        assert_eq!(serde_json::from_str::<U53>("42").unwrap().get(), 42);
        assert!(serde_json::from_str::<U53>("-1").is_err());
        assert!(serde_json::from_str::<U53>("1.5").is_err());
    }

    #[test]
    fn arithmetic_stays_in_range() {
        assert_eq!(U53::MAX.next(), None);
        assert_eq!(U53::MAX.saturating_add(10), U53::MAX);
        assert_eq!(U53::ZERO.saturating_sub(1), U53::ZERO);
        assert_eq!(U53::ONE.checked_add(1), U53::new(2));
        assert_eq!(U53::from_const(u64::MAX), U53::MAX);
    }
}
