//! The boundary to `otterd_proto::health`.
//!
//! Inside the crate an attempt's cause is typed by its outcome (a target
//! failure can only carry a target cause); on the wire every attempt is a
//! flat `(outcome, cause, phase)`. This module is the one place the two
//! meet, and its tests pin that the round folding here agrees with
//! `otterd_proto::health::round_outcome` for every sequence of attempts.

use crate::admission::RoundSpec;
use crate::outcome::{Attempt, ConfigCause, Phase, RoundOutcome, TargetCause, UnknownCause};
use otterd_proto::health::{
    AttemptResult, Cause, FailureDomain, HealthCheck, LatencyPhases, ObservationIdentity, Outcome,
    ProbeResult, ProtocolPhase, Qualification, ROUND_OVERHEAD_MS,
};
use otterd_proto::num::U53;
use std::time::Duration;

/// Durations on the wire, saturating at the largest exact integer.
pub(crate) fn wire_ms(d: Duration) -> U53 {
    U53::new(u64::try_from(d.as_millis()).unwrap_or(u64::MAX)).unwrap_or(U53::MAX)
}

pub(crate) fn wire_us(d: Duration) -> U53 {
    U53::new(u64::try_from(d.as_micros()).unwrap_or(u64::MAX)).unwrap_or(U53::MAX)
}

pub fn phase(p: Phase) -> ProtocolPhase {
    match p {
        Phase::Schedule => ProtocolPhase::Schedule,
        Phase::Resolve => ProtocolPhase::Resolve,
        Phase::Connect => ProtocolPhase::Connect,
        Phase::TlsHandshake => ProtocolPhase::Tls,
        Phase::Request => ProtocolPhase::Request,
        Phase::Response => ProtocolPhase::Response,
        Phase::Assert => ProtocolPhase::Assert,
    }
}

pub fn target_cause(c: TargetCause) -> Cause {
    match c {
        TargetCause::TargetTimeout => Cause::TargetTimeout,
        TargetCause::ConnectionRefused => Cause::ConnectionRefused,
        TargetCause::TargetUnreachable => Cause::TargetUnreachable,
        TargetCause::ConnectionReset => Cause::ConnectionReset,
        TargetCause::AssertionFailed => Cause::AssertionFailed,
        TargetCause::TlsInvalid => Cause::TlsInvalid,
        TargetCause::CertExpiring => Cause::CertExpiring,
        TargetCause::TargetDnsFailure => Cause::TargetDnsFailure,
        TargetCause::DnsServfail => Cause::DnsServfail,
        TargetCause::DnsNxdomain => Cause::DnsNxdomain,
        TargetCause::ProtocolError => Cause::ProtocolError,
    }
}

pub fn unknown_cause(c: UnknownCause) -> Cause {
    match c {
        UnknownCause::ProbeCapacity => Cause::ProbeCapacity,
        UnknownCause::RoundBudgetExceeded => Cause::RoundBudgetExceeded,
        UnknownCause::ExecutorOverloaded => Cause::ExecutorOverloaded,
        UnknownCause::ExecutorFailure => Cause::ExecutorFailure,
        UnknownCause::LocalResolverFailure => Cause::LocalResolverFailure,
    }
}

pub fn config_cause(c: ConfigCause) -> Cause {
    match c {
        ConfigCause::PermissionMissing => Cause::PermissionMissing,
        ConfigCause::CaMaterialMissing => Cause::CaMaterialMissing,
        ConfigCause::Unsupported => Cause::UnsupportedConfiguration,
        ConfigCause::InvalidTarget => Cause::InvalidTarget,
    }
}

/// One attempt as the wire carries it.
pub fn attempt(a: &Attempt) -> AttemptResult {
    match a {
        Attempt::Success { latency } => AttemptResult {
            outcome: Outcome::Success,
            cause: Cause::Ok,
            phase: ProtocolPhase::Assert,
            elapsed_ms: wire_ms(*latency),
            latency_us: Some(wire_us(*latency)),
        },
        Attempt::TargetFailure {
            cause,
            phase: p,
            elapsed,
        } => AttemptResult {
            outcome: Outcome::TargetFailure,
            cause: target_cause(*cause),
            phase: phase(*p),
            elapsed_ms: wire_ms(*elapsed),
            latency_us: None,
        },
        Attempt::Unknown { cause, phase: p } => AttemptResult {
            outcome: Outcome::Unknown,
            cause: unknown_cause(*cause),
            phase: phase(*p),
            elapsed_ms: U53::ZERO,
            latency_us: None,
        },
        Attempt::ConfigurationError { cause } => AttemptResult {
            outcome: Outcome::ConfigurationError,
            cause: config_cause(*cause),
            phase: ProtocolPhase::Schedule,
            elapsed_ms: U53::ZERO,
            latency_us: None,
        },
    }
}

/// A round's vote as the wire carries it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WireRound {
    pub outcome: Outcome,
    pub cause: Cause,
    pub phase: ProtocolPhase,
    pub failure_domain: FailureDomain,
    pub qualification: Qualification,
}

/// The round's outcome, with the phase of the attempt that decided it.
pub fn round(outcome: &RoundOutcome, attempts: &[Attempt]) -> WireRound {
    let last_phase = attempts
        .last()
        .map_or(ProtocolPhase::Schedule, |a| self::attempt(a).phase);
    match outcome {
        RoundOutcome::Success { .. } => WireRound {
            outcome: Outcome::Success,
            cause: Cause::Ok,
            phase: ProtocolPhase::Assert,
            failure_domain: FailureDomain::Target,
            qualification: Qualification::Qualified,
        },
        RoundOutcome::TargetFailure { cause, phase: p } => WireRound {
            outcome: Outcome::TargetFailure,
            cause: target_cause(*cause),
            phase: phase(*p),
            failure_domain: FailureDomain::Target,
            qualification: Qualification::Qualified,
        },
        RoundOutcome::Unknown { cause } => WireRound {
            outcome: Outcome::Unknown,
            cause: unknown_cause(*cause),
            phase: last_phase,
            failure_domain: FailureDomain::Executor,
            qualification: Qualification::Unqualified {
                cause: unknown_cause(*cause),
            },
        },
        RoundOutcome::ConfigurationError { cause } => WireRound {
            outcome: Outcome::ConfigurationError,
            cause: config_cause(*cause),
            phase: last_phase,
            failure_domain: FailureDomain::Configuration,
            qualification: Qualification::Unqualified {
                cause: config_cause(*cause),
            },
        },
    }
}

/// Why a check's timing cannot be run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum TimingError {
    #[error("more retries than an attempt count can hold")]
    TooManyRetries,
}

/// The round timing a check asks for. Admission validates it.
///
/// # Errors
/// The retry count does not fit an attempt count.
pub fn round_spec(check: &HealthCheck) -> Result<RoundSpec, TimingError> {
    let ms = |v: U53| Duration::from_millis(v.get());
    let attempts = check
        .retries
        .checked_add(1)
        .and_then(|a| u8::try_from(a).ok())
        .ok_or(TimingError::TooManyRetries)?;
    Ok(RoundSpec {
        interval: ms(check.interval_ms),
        attempts,
        attempt_timeout: ms(check.attempt_timeout_ms),
        backoff: ms(check.retry_backoff_ms),
        overhead: Duration::from_millis(ROUND_OVERHEAD_MS),
        budget: ms(check.round_budget_ms),
    })
}

/// How long a round's state stands: two intervals plus the round budget,
/// so one late or missed round does not make the check Unknown, and two do.
pub fn result_ttl(spec: &RoundSpec) -> Duration {
    spec.interval * 2 + spec.budget
}

/// One executed (or missed) round as the contract's probe result.
///
/// The caller supplies what the executor does not know: the observation
/// identity (check, revision, subject, vantage, node, epoch, boot and the
/// sequence number it persists), the check's outcome-policy revision and the
/// clock's uncertainty.
pub fn probe_result<K>(
    record: &crate::executor::RoundRecord<K>,
    identity: ObservationIdentity,
    spec: &RoundSpec,
    outcome_policy_revision: U53,
    clock_uncertainty: Duration,
) -> ProbeResult {
    let vote = round(&record.outcome, &record.attempts);
    let total_us = match record.outcome {
        RoundOutcome::Success { latency } => Some(wire_us(latency)),
        _ => None,
    };
    ProbeResult {
        identity,
        scheduled_round: U53::new(record.round_seq).unwrap_or(U53::MAX),
        attempts: record.attempts.iter().map(attempt).collect(),
        final_outcome: vote.outcome,
        cause: vote.cause,
        failure_domain: vote.failure_domain,
        phase: vote.phase,
        outcome_policy_revision,
        qualification: vote.qualification,
        observed_at_unix_ms: U53::new(record.observed_at_ms).unwrap_or(U53::MAX),
        elapsed_monotonic_ms: wire_ms(record.elapsed),
        clock_uncertainty_ms: wire_ms(clock_uncertainty),
        ttl_ms: wire_ms(result_ttl(spec)),
        latency: LatencyPhases {
            total_us,
            ..LatencyPhases::default()
        },
        certificate_expiry_unix_ms: record
            .certificate
            .and_then(|c| u64::try_from(c.not_after).ok())
            .and_then(|secs| U53::new(secs.saturating_mul(1_000))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::outcome::fold;
    use otterd_proto::health::round_outcome;
    use proptest::prelude::*;

    fn any_attempt() -> impl Strategy<Value = Attempt> {
        let target = prop_oneof![
            Just(TargetCause::TargetTimeout),
            Just(TargetCause::ConnectionRefused),
            Just(TargetCause::DnsServfail),
            Just(TargetCause::ProtocolError),
        ];
        let unknown = prop_oneof![
            Just(UnknownCause::ProbeCapacity),
            Just(UnknownCause::ExecutorOverloaded),
            Just(UnknownCause::LocalResolverFailure),
        ];
        prop_oneof![
            (1u64..5_000).prop_map(|ms| Attempt::Success {
                latency: Duration::from_millis(ms)
            }),
            target.prop_map(|cause| Attempt::TargetFailure {
                cause,
                phase: Phase::Connect,
                elapsed: Duration::from_secs(5),
            }),
            unknown.prop_map(|cause| Attempt::Unknown {
                cause,
                phase: Phase::Resolve,
            }),
            Just(Attempt::ConfigurationError {
                cause: ConfigCause::PermissionMissing
            }),
        ]
    }

    proptest! {
        /// The executor's fold and the contract's fold agree on every round.
        #[test]
        fn fold_agrees_with_the_contract(
            attempts in proptest::collection::vec(any_attempt(), 0..4),
            configured in 1u8..4,
        ) {
            let ours = round(&fold(&attempts, configured), &attempts);
            let wire: Vec<AttemptResult> = attempts.iter().map(attempt).collect();
            prop_assert_eq!(ours.outcome, round_outcome(&wire, u32::from(configured)));
            prop_assert_eq!(ours.outcome.is_vote(), ours.qualification == Qualification::Qualified);
        }
    }

    #[test]
    fn every_cause_has_a_distinct_wire_code() {
        let target = [
            TargetCause::TargetTimeout,
            TargetCause::ConnectionRefused,
            TargetCause::TargetUnreachable,
            TargetCause::ConnectionReset,
            TargetCause::AssertionFailed,
            TargetCause::TlsInvalid,
            TargetCause::CertExpiring,
            TargetCause::TargetDnsFailure,
            TargetCause::DnsServfail,
            TargetCause::DnsNxdomain,
            TargetCause::ProtocolError,
        ]
        .map(target_cause);
        let unknown = [
            UnknownCause::ProbeCapacity,
            UnknownCause::RoundBudgetExceeded,
            UnknownCause::ExecutorOverloaded,
            UnknownCause::ExecutorFailure,
            UnknownCause::LocalResolverFailure,
        ]
        .map(unknown_cause);
        let config = [
            ConfigCause::PermissionMissing,
            ConfigCause::CaMaterialMissing,
            ConfigCause::Unsupported,
            ConfigCause::InvalidTarget,
        ]
        .map(config_cause);
        let all: Vec<Cause> = target.into_iter().chain(unknown).chain(config).collect();
        let distinct: std::collections::HashSet<String> = all
            .iter()
            .map(|c| serde_json::to_string(c).unwrap())
            .collect();
        assert_eq!(distinct.len(), all.len());
        assert_eq!(
            serde_json::to_string(&Cause::ExecutorOverloaded).unwrap(),
            r#""executor_overloaded""#
        );
    }

    #[test]
    fn the_default_check_timing_is_the_default_round() {
        let check: HealthCheck = serde_json::from_value(serde_json::json!({
            "installId": "i", "orgId": "o", "id": "c", "revision": 1, "subjectId": "s",
            "role": "uptime", "vantage": "outside",
            "probe": {"kind": "tcp", "host": "example.com", "port": 443},
            "intervalMs": 60000, "attemptTimeoutMs": 5000, "retries": 1, "retryBackoffMs": 1000,
            "roundBudgetMs": 15000, "startPeriodMs": 0, "failureThreshold": 1,
            "successThreshold": 1, "readyHoldMs": 0, "degradedAfterMs": 2000,
            "healthAction": "none", "outcomePolicyRevision": 1
        }))
        .unwrap();
        assert_eq!(round_spec(&check).unwrap(), RoundSpec::UPTIME_DEFAULT);
    }

    #[test]
    fn a_round_record_becomes_a_contract_probe_result() {
        use crate::admission::Pool;
        use crate::executor::RoundRecord;
        use crate::outcome::HealthState;
        let record = RoundRecord {
            key: 1u32,
            pool: Pool::User,
            round_seq: 41,
            observed_at_ms: 1_791_810_374_922,
            started_late: Duration::ZERO,
            attempts: vec![
                Attempt::TargetFailure {
                    cause: TargetCause::TargetTimeout,
                    phase: Phase::Connect,
                    elapsed: Duration::from_secs(5),
                },
                Attempt::Success {
                    latency: Duration::from_millis(42),
                },
            ],
            elapsed: Duration::from_millis(6_050),
            outcome: RoundOutcome::Success {
                latency: Duration::from_millis(42),
            },
            state: HealthState::Healthy,
            certificate: None,
        };
        let identity: ObservationIdentity = serde_json::from_value(serde_json::json!({
            "installId": "i", "orgId": "o", "checkId": "c", "checkRevision": 3,
            "subjectId": "s", "vantage": "outside", "observerNodeId": "m1",
            "nodeEpoch": 1, "bootId": "b", "sampleSeq": 9
        }))
        .unwrap();
        let r = probe_result(
            &record,
            identity,
            &RoundSpec::UPTIME_DEFAULT,
            U53::ONE,
            Duration::from_millis(5),
        );
        assert_eq!(r.final_outcome, Outcome::Success);
        assert_eq!(r.qualification, Qualification::Qualified);
        assert_eq!(
            r.attempts.len(),
            2,
            "the failed first attempt stays as a diagnostic"
        );
        assert_eq!(r.attempts[0].cause, Cause::TargetTimeout);
        assert_eq!(r.latency.total_us, Some(U53::from_const(42_000)));
        assert_eq!(r.ttl_ms, U53::from_const(135_000));
        assert_eq!(r.scheduled_round, U53::from_const(41));
        // the contract's own fold agrees with the vote we report
        assert_eq!(
            otterd_proto::health::round_outcome(&r.attempts, 2),
            r.final_outcome
        );
        // and it is valid on the wire
        let json = serde_json::to_value(&r).unwrap();
        let back: ProbeResult = serde_json::from_value(json).unwrap();
        assert_eq!(back, r);
    }
}
