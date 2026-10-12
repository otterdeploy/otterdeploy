//! What a probe attempt and a probe round mean.
//!
//! Every attempt is exactly one of four outcomes. Only two of them are
//! votes about the target:
//!
//! - [`Attempt::Success`]: the expected result, measured by a qualified
//!   executor;
//! - [`Attempt::TargetFailure`]: a measured failure *from this vantage*
//!   (refused, timed out, wrong answer, invalid certificate);
//! - [`Attempt::Unknown`]: the executor could not take or qualify the
//!   measurement (no slot, missed deadline, broken local resolver, overloaded
//!   runtime). Never a failure, never a restart trigger;
//! - [`Attempt::ConfigurationError`]: the check cannot run as configured
//!   (missing permission, missing CA material, unsupported option).
//!
//! A round folds its attempts into one [`RoundOutcome`]: one round is one
//! vote, retries are not extra votes. Causes and phases are small closed
//! sets so they can be stored, compared and shown (redacted) on public pages
//! without free-form error text.

use serde::Serialize;
use std::time::Duration;

/// Where in the protocol an attempt stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    /// Waiting for a slot or for the scheduled start.
    Schedule,
    /// Resolving the target's name.
    Resolve,
    Connect,
    TlsHandshake,
    /// Sending a request or query.
    Request,
    /// Waiting for or reading the response.
    Response,
    /// Checking the response against the check's expectations.
    Assert,
}

/// Why the target was judged failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TargetCause {
    /// The target did not answer within the attempt timeout.
    TargetTimeout,
    ConnectionRefused,
    /// A host or network unreachable answer for the target.
    TargetUnreachable,
    /// The connection was reset or closed before a complete response.
    ConnectionReset,
    /// The response did not meet an explicit expectation of the check.
    AssertionFailed,
    /// Certificate chain, hostname or validity period rejected.
    TlsInvalid,
    /// The certificate is valid for fewer days than the check requires.
    CertExpiring,
    /// The target's name did not resolve through a healthy resolver.
    TargetDnsFailure,
    /// The resolver under test answered SERVFAIL where an answer was expected.
    DnsServfail,
    /// The resolver under test answered NXDOMAIN where an answer was expected.
    DnsNxdomain,
    /// The target spoke something other than the expected protocol.
    ProtocolError,
}

/// Why the executor could not take or qualify the measurement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UnknownCause {
    /// No probe slot was free when the round was due.
    ProbeCapacity,
    /// The round could not finish inside its reserved budget.
    RoundBudgetExceeded,
    /// The executor's timers ran late: a timeout seen now may be our own
    /// stall, not the target's.
    ExecutorOverloaded,
    /// A local facility failed (socket exhaustion, an unexpected local error).
    ExecutorFailure,
    /// The local resolver used to reach the target is not answering.
    LocalResolverFailure,
}

/// Why the check cannot run as configured.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfigCause {
    /// ICMP without `CAP_NET_RAW` or a `ping_group_range` that admits us.
    PermissionMissing,
    /// A CA bundle the check names is missing or unreadable.
    CaMaterialMissing,
    /// An option or combination this executor does not support.
    Unsupported,
    /// A malformed target (bad URL, empty host, port 0).
    InvalidTarget,
}

/// One attempt's result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum Attempt {
    Success {
        #[serde(with = "micros")]
        latency: Duration,
    },
    TargetFailure {
        cause: TargetCause,
        phase: Phase,
        #[serde(with = "micros")]
        elapsed: Duration,
    },
    Unknown {
        cause: UnknownCause,
        phase: Phase,
    },
    ConfigurationError {
        cause: ConfigCause,
    },
}

impl Attempt {
    /// Whether another attempt could change the round's result. A success
    /// ends the round, and so does a configuration error: retrying the same
    /// configuration cannot fix it.
    pub fn is_final(&self) -> bool {
        matches!(self, Self::Success { .. } | Self::ConfigurationError { .. })
    }
}

/// The one vote a round contributes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum RoundOutcome {
    Success {
        /// The successful attempt's latency: the final-round latency, kept
        /// apart from the latencies of failed attempts before it.
        #[serde(with = "micros")]
        latency: Duration,
    },
    TargetFailure {
        /// The last attempt's cause and phase.
        cause: TargetCause,
        phase: Phase,
    },
    Unknown {
        cause: UnknownCause,
    },
    ConfigurationError {
        cause: ConfigCause,
    },
}

impl RoundOutcome {
    /// Whether this round counts as a vote about the target at all.
    pub fn is_vote(&self) -> bool {
        matches!(self, Self::Success { .. } | Self::TargetFailure { .. })
    }
}

/// Fold a round's attempts into its outcome.
///
/// - Any qualified success makes the round a success.
/// - A configuration error makes it a configuration error.
/// - Only when **every** configured attempt ran and measured a target
///   failure is the round a target failure.
/// - Otherwise (an attempt was unqualified, or attempts are missing because
///   the round ran out of budget) the round is Unknown; the failed attempts
///   stay in the round's record as diagnostics.
///
/// `configured` is the number of attempts the check asked for; an empty
/// round is Unknown (`RoundBudgetExceeded`), never a failure.
pub fn fold(attempts: &[Attempt], configured: u8) -> RoundOutcome {
    if let Some(latency) = attempts.iter().find_map(|a| match a {
        Attempt::Success { latency } => Some(*latency),
        _ => None,
    }) {
        return RoundOutcome::Success { latency };
    }
    if let Some(cause) = attempts.iter().find_map(|a| match a {
        Attempt::ConfigurationError { cause } => Some(*cause),
        _ => None,
    }) {
        return RoundOutcome::ConfigurationError { cause };
    }
    if let Some(cause) = attempts.iter().find_map(|a| match a {
        Attempt::Unknown { cause, .. } => Some(*cause),
        _ => None,
    }) {
        return RoundOutcome::Unknown { cause };
    }
    if attempts.len() < usize::from(configured.max(1)) {
        return RoundOutcome::Unknown {
            cause: UnknownCause::RoundBudgetExceeded,
        };
    }
    match attempts.last() {
        Some(Attempt::TargetFailure { cause, phase, .. }) => RoundOutcome::TargetFailure {
            cause: *cause,
            phase: *phase,
        },
        // Unreachable given the checks above; Unknown is the safe answer.
        _ => RoundOutcome::Unknown {
            cause: UnknownCause::ExecutorFailure,
        },
    }
}

/// The health state a round establishes for its TTL.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthState {
    Healthy,
    /// Succeeded, but slower than the check's degraded threshold.
    Degraded,
    Down,
    /// No qualified vote: Unknown and configuration errors alike.
    Unknown,
}

impl HealthState {
    pub fn of(round: &RoundOutcome, degraded_after: Option<Duration>) -> Self {
        match round {
            RoundOutcome::Success { latency } => match degraded_after {
                Some(limit) if *latency > limit => Self::Degraded,
                _ => Self::Healthy,
            },
            RoundOutcome::TargetFailure { .. } => Self::Down,
            RoundOutcome::Unknown { .. } | RoundOutcome::ConfigurationError { .. } => Self::Unknown,
        }
    }
}

/// Durations travel as whole microseconds.
mod micros {
    use serde::Serializer;
    use std::time::Duration;

    pub(super) fn serialize<S: Serializer>(d: &Duration, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_u64(u64::try_from(d.as_micros()).unwrap_or(u64::MAX))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    const MS: Duration = Duration::from_millis(1);

    fn fail(cause: TargetCause) -> Attempt {
        Attempt::TargetFailure {
            cause,
            phase: Phase::Connect,
            elapsed: 5 * MS,
        }
    }

    fn unknown(cause: UnknownCause) -> Attempt {
        Attempt::Unknown {
            cause,
            phase: Phase::Schedule,
        }
    }

    #[test]
    fn a_successful_retry_is_one_success_vote_with_its_own_latency() {
        let r = fold(
            &[
                fail(TargetCause::TargetTimeout),
                Attempt::Success { latency: 40 * MS },
            ],
            2,
        );
        assert_eq!(r, RoundOutcome::Success { latency: 40 * MS });
        assert!(r.is_vote());
    }

    #[test]
    fn all_attempts_failing_is_a_target_failure() {
        let r = fold(
            &[
                fail(TargetCause::TargetTimeout),
                fail(TargetCause::ConnectionRefused),
            ],
            2,
        );
        assert_eq!(
            r,
            RoundOutcome::TargetFailure {
                cause: TargetCause::ConnectionRefused,
                phase: Phase::Connect
            }
        );
    }

    #[test]
    fn a_missing_attempt_makes_failures_unknown() {
        // the round ran out of budget before its retry
        let r = fold(&[fail(TargetCause::TargetTimeout)], 2);
        assert_eq!(
            r,
            RoundOutcome::Unknown {
                cause: UnknownCause::RoundBudgetExceeded
            }
        );
        assert!(!r.is_vote());
    }

    #[test]
    fn an_unqualified_attempt_makes_failures_unknown() {
        let r = fold(
            &[
                fail(TargetCause::TargetTimeout),
                unknown(UnknownCause::ExecutorOverloaded),
            ],
            2,
        );
        assert_eq!(
            r,
            RoundOutcome::Unknown {
                cause: UnknownCause::ExecutorOverloaded
            }
        );
    }

    #[test]
    fn configuration_errors_are_not_votes() {
        let r = fold(
            &[Attempt::ConfigurationError {
                cause: ConfigCause::PermissionMissing,
            }],
            2,
        );
        assert_eq!(
            r,
            RoundOutcome::ConfigurationError {
                cause: ConfigCause::PermissionMissing
            }
        );
        assert_eq!(HealthState::of(&r, None), HealthState::Unknown);
    }

    #[test]
    fn an_empty_round_is_never_a_failure() {
        assert_eq!(
            fold(&[], 1),
            RoundOutcome::Unknown {
                cause: UnknownCause::RoundBudgetExceeded
            }
        );
    }

    #[test]
    fn degraded_is_a_slow_success_not_healthy() {
        let slow = RoundOutcome::Success { latency: 900 * MS };
        assert_eq!(
            HealthState::of(&slow, Some(500 * MS)),
            HealthState::Degraded
        );
        assert_eq!(HealthState::of(&slow, None), HealthState::Healthy);
    }

    #[test]
    fn serialises_to_closed_codes() {
        let json = serde_json::to_string(&fail(TargetCause::DnsServfail)).unwrap();
        assert_eq!(
            json,
            r#"{"outcome":"target_failure","cause":"dns_servfail","phase":"connect","elapsed":5000}"#
        );
    }

    fn any_attempt() -> impl Strategy<Value = Attempt> {
        prop_oneof![
            (1u64..10_000).prop_map(|ms| Attempt::Success {
                latency: Duration::from_millis(ms)
            }),
            Just(fail(TargetCause::TargetTimeout)),
            Just(fail(TargetCause::ConnectionRefused)),
            Just(unknown(UnknownCause::ProbeCapacity)),
            Just(unknown(UnknownCause::LocalResolverFailure)),
            Just(Attempt::ConfigurationError {
                cause: ConfigCause::Unsupported
            }),
        ]
    }

    proptest! {
        /// Unknown and configuration attempts can never turn into a failure
        /// vote, and a failure vote needs every configured attempt measured.
        #[test]
        fn failure_votes_need_every_attempt_measured(
            attempts in proptest::collection::vec(any_attempt(), 0..4),
            configured in 1u8..4,
        ) {
            let r = fold(&attempts, configured);
            if matches!(r, RoundOutcome::TargetFailure { .. }) {
                prop_assert!(attempts.len() >= usize::from(configured));
                let all_failed = attempts.iter().all(|a| matches!(a, Attempt::TargetFailure { .. }));
                prop_assert!(all_failed);
            }
            if attempts.iter().any(|a| matches!(a, Attempt::Success { .. })) {
                let is_success = matches!(r, RoundOutcome::Success { .. });
                prop_assert!(is_success);
            }
        }
    }
}
