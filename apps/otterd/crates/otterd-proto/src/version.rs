//! Protocol and schema versions, and their negotiation.
//!
//! One integer names the wire protocol. A node offers the range it speaks; the
//! control plane picks the highest version both sides speak, or refuses with its
//! own range so the operator sees which side must upgrade.
//!
//! Compatibility rule inside one protocol version: a sender may add an optional
//! field to a telemetry or report frame, and receivers ignore fields they do not
//! know. Authority documents (capabilities, leases, grants, serving sets, signed
//! manifests) reject unknown fields, so a field that restricts authority can never
//! be silently dropped by an older node; adding one needs a new protocol version.

use serde::{Deserialize, Serialize};

/// The protocol this build speaks natively.
pub const PROTOCOL_VERSION: u16 = 1;
/// The oldest protocol this build still speaks.
pub const MIN_PROTOCOL_VERSION: u16 = 1;
/// On-disk node journal format (see [`crate::journal`]).
pub const JOURNAL_FORMAT: u16 = 1;
/// [`crate::spec::ServiceSpec`] schema.
pub const SERVICE_SPEC_SCHEMA: u16 = 1;
/// Health check evaluator IR revision.
pub const EVALUATOR_REVISION: u16 = 1;
/// Metric sample schema.
pub const METRIC_SCHEMA: u16 = 1;

/// An inclusive range of protocol versions.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VersionRange {
    pub min: u16,
    pub max: u16,
}

impl VersionRange {
    /// What this build speaks.
    pub const CURRENT: Self = Self {
        min: MIN_PROTOCOL_VERSION,
        max: PROTOCOL_VERSION,
    };

    #[must_use]
    pub fn contains(self, version: u16) -> bool {
        self.min <= version && version <= self.max
    }

    #[must_use]
    pub fn is_valid(self) -> bool {
        self.min >= 1 && self.min <= self.max
    }
}

/// Why two ranges have no common version.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum NegotiationError {
    #[error("malformed version range {0:?}")]
    Malformed(VersionRange),
    #[error("node speaks {node:?}, control plane {cp:?}: the node must be upgraded")]
    NodeTooOld {
        node: VersionRange,
        cp: VersionRange,
    },
    #[error("node speaks {node:?}, control plane {cp:?}: the control plane must be upgraded")]
    ControlPlaneTooOld {
        node: VersionRange,
        cp: VersionRange,
    },
}

/// Highest version both ranges contain.
pub fn negotiate(node: VersionRange, cp: VersionRange) -> Result<u16, NegotiationError> {
    if !node.is_valid() {
        return Err(NegotiationError::Malformed(node));
    }
    if !cp.is_valid() {
        return Err(NegotiationError::Malformed(cp));
    }
    let high = node.max.min(cp.max);
    let low = node.min.max(cp.min);
    if low <= high {
        Ok(high)
    } else if node.max < cp.min {
        Err(NegotiationError::NodeTooOld { node, cp })
    } else {
        Err(NegotiationError::ControlPlaneTooOld { node, cp })
    }
}

/// Optional behaviours advertised in the handshake. A feature is used only when
/// both sides list it; nothing safety-relevant may hide behind a feature flag.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Feature {
    /// Bulk channel (exec, logs, archives).
    Bulk,
    /// Realtime metric cadence below the history tick.
    RealtimeMetrics,
    /// Probe executor for health checks.
    ProbeExecutor,
    /// Discovery frames relayed by the control plane.
    DiscoveryRelay,
    /// Platform bootstrap supervision.
    PlatformBootstrap,
}

impl Feature {
    pub const ALL: [Self; 5] = [
        Self::Bulk,
        Self::RealtimeMetrics,
        Self::ProbeExecutor,
        Self::DiscoveryRelay,
        Self::PlatformBootstrap,
    ];
}

/// Features both sides listed, in a stable order.
#[must_use]
pub fn common_features(a: &[Feature], b: &[Feature]) -> Vec<Feature> {
    let mut out: Vec<Feature> = a.iter().copied().filter(|f| b.contains(f)).collect();
    out.sort_unstable();
    out.dedup();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn r(min: u16, max: u16) -> VersionRange {
        VersionRange { min, max }
    }

    #[test]
    fn picks_the_highest_common_version() {
        assert_eq!(negotiate(r(1, 3), r(2, 5)), Ok(3));
        assert_eq!(negotiate(r(1, 1), r(1, 1)), Ok(1));
        assert_eq!(negotiate(r(4, 6), r(1, 4)), Ok(4));
    }

    #[test]
    fn names_the_side_that_must_upgrade() {
        assert!(matches!(
            negotiate(r(1, 1), r(2, 3)),
            Err(NegotiationError::NodeTooOld { .. })
        ));
        assert!(matches!(
            negotiate(r(4, 5), r(2, 3)),
            Err(NegotiationError::ControlPlaneTooOld { .. })
        ));
        assert!(matches!(
            negotiate(r(0, 1), r(1, 1)),
            Err(NegotiationError::Malformed(_))
        ));
        assert!(matches!(
            negotiate(r(3, 2), r(1, 1)),
            Err(NegotiationError::Malformed(_))
        ));
    }

    #[test]
    fn negotiation_is_symmetric_in_result() {
        for a in 1..5u16 {
            for b in a..6 {
                for c in 1..5u16 {
                    for d in c..6 {
                        let x = negotiate(r(a, b), r(c, d)).ok();
                        let y = negotiate(r(c, d), r(a, b)).ok();
                        assert_eq!(x, y);
                        if let Some(v) = x {
                            assert!(r(a, b).contains(v) && r(c, d).contains(v));
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn features_intersect() {
        let ours = [Feature::Bulk, Feature::ProbeExecutor, Feature::Bulk];
        let theirs = [
            Feature::ProbeExecutor,
            Feature::Bulk,
            Feature::RealtimeMetrics,
        ];
        assert_eq!(
            common_features(&ours, &theirs),
            vec![Feature::Bulk, Feature::ProbeExecutor]
        );
    }
}
