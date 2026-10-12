//! Health checks and probe results.
//!
//! One check definition and one outcome vocabulary for the node executor, the
//! monitor and the control-plane evaluator. One scheduled round yields one
//! observation; attempts are diagnostics, never extra votes.

use crate::ids::{AttemptId, BootId, CheckId, InstallId, NodeId, OrgId, ResourceId, SubjectId};
use crate::num::{DurationMs, U53, UnixMs};
use serde::{Deserialize, Serialize};

/// Fixed per-round setup/teardown overhead charged by admission.
pub const ROUND_OVERHEAD_MS: u64 = 4_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CheckRole {
    Readiness,
    Liveness,
    Uptime,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Vantage {
    LocalNetns,
    ServingPath,
    Fleet,
    Hairpin,
    Outside,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum HealthAction {
    None,
    /// Only valid for `liveness`; consumes the durable restart budget.
    Restart,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ExecCommand {
    /// Direct argv (Docker `CMD`).
    Argv { argv: Vec<String> },
    /// Image shell (Docker `CMD-SHELL`); a missing shell is a configuration error.
    Shell { script: String },
}

/// A structured HTTP assertion; all of a check's assertions must hold.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum HttpAssertion {
    /// Status within `min..=max` (an exact status has `min == max`).
    StatusRange { min: u16, max: u16 },
    /// A response header (case-insensitive name) contains `value`.
    HeaderContains { name: String, value: String },
    /// The (size-bounded) response body contains `value`.
    BodyContains { value: String },
    /// The JSON value at an RFC 6901 pointer equals `value`.
    JsonEquals {
        pointer: String,
        value: serde_json::Value,
    },
}

/// What a DNS check expects from the resolver under test.
/// `nxdomain`/`servfail` succeed only when explicitly expected.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum DnsExpect {
    /// A successful answer; when `contains` is set, one record must equal it.
    Answer {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        contains: Option<String>,
    },
    Nxdomain,
    Servfail,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Probe {
    #[serde(rename_all = "camelCase")]
    Exec {
        command: ExecCommand,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        user: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        workdir: Option<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        env_refs: Vec<String>,
    },
    Tcp {
        host: String,
        port: u16,
    },
    #[serde(rename_all = "camelCase")]
    Http {
        url: String,
        method: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        header_refs: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        body_ref: Option<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        assertions: Vec<HttpAssertion>,
        follow_redirects: bool,
        max_redirects: u8,
        tls_verify: bool,
        /// Extra trust roots (a secret/config reference), for private CAs.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ca_bundle_ref: Option<String>,
    },
    Grpc {
        host: String,
        port: u16,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        service: Option<String>,
        tls: bool,
    },
    #[serde(rename_all = "camelCase")]
    Dns {
        name: String,
        record_type: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        server: Option<String>,
        expect: DnsExpect,
    },
    #[serde(rename_all = "camelCase")]
    Tls {
        host: String,
        port: u16,
        /// SNI and the name verified against the certificate; defaults to `host`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        server_name: Option<String>,
        tls_verify: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ca_bundle_ref: Option<String>,
        min_days_valid: u32,
    },
    Icmp {
        host: String,
    },
}

/// A versioned check definition.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HealthCheck {
    pub install_id: InstallId,
    pub org_id: OrgId,
    pub id: CheckId,
    pub revision: U53,
    pub subject_id: SubjectId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource_id: Option<ResourceId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generation: Option<U53>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<AttemptId>,
    pub role: CheckRole,
    pub vantage: Vantage,
    pub probe: Probe,
    pub interval_ms: DurationMs,
    pub attempt_timeout_ms: DurationMs,
    pub retries: u32,
    pub retry_backoff_ms: DurationMs,
    pub round_budget_ms: DurationMs,
    pub start_period_ms: DurationMs,
    pub failure_threshold: u32,
    pub success_threshold: u32,
    pub ready_hold_ms: DurationMs,
    pub degraded_after_ms: DurationMs,
    pub health_action: HealthAction,
    pub outcome_policy_revision: U53,
}

/// Why a check definition is not admissible.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CheckIssue {
    #[error("healthAction=restart is only valid for role=liveness")]
    RestartRequiresLiveness,
    #[error("round budget is shorter than attempts × timeout + backoff + overhead")]
    RoundBudgetTooShort,
    #[error("round budget must be shorter than the interval")]
    RoundBudgetNotBelowInterval,
    #[error("interval must be between 30 s and 1 h for uptime checks")]
    UptimeIntervalOutOfRange,
    #[error("thresholds must be at least 1")]
    ThresholdZero,
}

impl HealthCheck {
    /// `a*t + (a−1)*b + o`, the smallest admissible round budget.
    #[must_use]
    pub fn minimum_round_budget_ms(&self) -> u64 {
        let attempts = u64::from(self.retries) + 1;
        attempts
            .saturating_mul(self.attempt_timeout_ms.get())
            .saturating_add((attempts - 1).saturating_mul(self.retry_backoff_ms.get()))
            .saturating_add(ROUND_OVERHEAD_MS)
    }

    /// Admission weight `B / I` in thousandths of a probe slot.
    #[must_use]
    pub fn weight_millis(&self) -> u64 {
        self.round_budget_ms
            .get()
            .saturating_mul(1000)
            .checked_div(self.interval_ms.get())
            .unwrap_or(u64::MAX)
    }

    pub fn validate(&self) -> Result<(), CheckIssue> {
        if self.health_action == HealthAction::Restart && self.role != CheckRole::Liveness {
            return Err(CheckIssue::RestartRequiresLiveness);
        }
        if self.failure_threshold == 0 || self.success_threshold == 0 {
            return Err(CheckIssue::ThresholdZero);
        }
        if self.round_budget_ms.get() < self.minimum_round_budget_ms() {
            return Err(CheckIssue::RoundBudgetTooShort);
        }
        if self.round_budget_ms >= self.interval_ms {
            return Err(CheckIssue::RoundBudgetNotBelowInterval);
        }
        if self.role == CheckRole::Uptime && !(30_000..=3_600_000).contains(&self.interval_ms.get())
        {
            return Err(CheckIssue::UptimeIntervalOutOfRange);
        }
        Ok(())
    }
}

/// Normalized outcome of an attempt or a round.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Outcome {
    Success,
    TargetFailure,
    /// The executor could not run or qualify the measurement: no vote.
    Unknown,
    /// The check cannot be executed as configured: no vote.
    ConfigurationError,
}

impl Outcome {
    pub const ALL: [Self; 4] = [
        Self::Success,
        Self::TargetFailure,
        Self::Unknown,
        Self::ConfigurationError,
    ];
}

impl Outcome {
    /// Only success and target failure are votes.
    #[must_use]
    pub fn is_vote(self) -> bool {
        matches!(self, Self::Success | Self::TargetFailure)
    }
}

/// Bounded cause codes. Never free-form error text.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Cause {
    Ok,
    TargetTimeout,
    ConnectionRefused,
    TargetUnreachable,
    AssertionFailed,
    TlsInvalid,
    CertExpiring,
    TargetDnsFailure,
    CheckExit,
    CheckTimeout,
    ProbeCapacity,
    ExecutorFailure,
    LocalResolverFailure,
    PermissionMissing,
    UnsupportedConfiguration,
    MissingShell,
    VantageMissing,
    ConnectionReset,
    /// Wrong protocol on the port, or a TLS alert.
    ProtocolError,
    /// The resolver under test answered SERVFAIL (DNS checks).
    DnsServfail,
    /// The resolver under test answered NXDOMAIN (DNS checks).
    DnsNxdomain,
    /// The round budget ran out before every configured attempt ran.
    RoundBudgetExceeded,
    /// The executor's deadline timer fired more than 500 ms late.
    ExecutorOverloaded,
    /// Trust material the check names is not available.
    CaMaterialMissing,
    /// The target is not allowed (metadata, link-local, loopback, unauthorized range).
    InvalidTarget,
}

impl Cause {
    pub const ALL: [Self; 25] = [
        Self::Ok,
        Self::TargetTimeout,
        Self::ConnectionRefused,
        Self::TargetUnreachable,
        Self::AssertionFailed,
        Self::TlsInvalid,
        Self::CertExpiring,
        Self::TargetDnsFailure,
        Self::CheckExit,
        Self::CheckTimeout,
        Self::ProbeCapacity,
        Self::ExecutorFailure,
        Self::LocalResolverFailure,
        Self::PermissionMissing,
        Self::UnsupportedConfiguration,
        Self::MissingShell,
        Self::VantageMissing,
        Self::ConnectionReset,
        Self::ProtocolError,
        Self::DnsServfail,
        Self::DnsNxdomain,
        Self::RoundBudgetExceeded,
        Self::ExecutorOverloaded,
        Self::CaMaterialMissing,
        Self::InvalidTarget,
    ];
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FailureDomain {
    Target,
    Executor,
    Configuration,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProtocolPhase {
    Schedule,
    Resolve,
    Connect,
    Tls,
    Request,
    Response,
    Assert,
    Exec,
}

/// Identity of one observation.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservationIdentity {
    pub install_id: InstallId,
    pub org_id: OrgId,
    pub check_id: CheckId,
    pub check_revision: U53,
    pub subject_id: SubjectId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generation: Option<U53>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<AttemptId>,
    pub vantage: Vantage,
    pub observer_node_id: NodeId,
    pub node_epoch: U53,
    pub boot_id: BootId,
    /// Persisted per boot; dedupe key together with the rest of the identity.
    pub sample_seq: U53,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencyPhases {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolve_us: Option<U53>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connect_us: Option<U53>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tls_us: Option<U53>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_byte_us: Option<U53>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_us: Option<U53>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptResult {
    pub outcome: Outcome,
    pub cause: Cause,
    pub phase: ProtocolPhase,
    pub elapsed_ms: DurationMs,
    /// Successful attempts only; failures never become 0 ms.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latency_us: Option<U53>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum Qualification {
    Qualified,
    Unqualified { cause: Cause },
}

/// One round's result.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub identity: ObservationIdentity,
    pub scheduled_round: U53,
    pub attempts: Vec<AttemptResult>,
    pub final_outcome: Outcome,
    pub cause: Cause,
    pub failure_domain: FailureDomain,
    pub phase: ProtocolPhase,
    pub outcome_policy_revision: U53,
    pub qualification: Qualification,
    pub observed_at_unix_ms: UnixMs,
    pub elapsed_monotonic_ms: DurationMs,
    pub clock_uncertainty_ms: DurationMs,
    /// Default 2 intervals + round budget.
    pub ttl_ms: DurationMs,
    #[serde(default)]
    pub latency: LatencyPhases,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub certificate_expiry_unix_ms: Option<UnixMs>,
}

/// Fold attempt outcomes into the round's single vote.
///
/// `configured` is the number of attempts the check allows (`retries + 1`).
/// Any success wins. Any configuration error makes the round a configuration
/// error. Otherwise the round is a target failure only when every configured
/// attempt ran and failed at the target; a missing (budget ran out, executor
/// stalled) or unqualified attempt makes it Unknown.
#[must_use]
pub fn round_outcome(attempts: &[AttemptResult], configured: u32) -> Outcome {
    if attempts.iter().any(|a| a.outcome == Outcome::Success) {
        Outcome::Success
    } else if attempts
        .iter()
        .any(|a| a.outcome == Outcome::ConfigurationError)
    {
        Outcome::ConfigurationError
    } else if !attempts.is_empty()
        && attempts.len() >= usize::try_from(configured).unwrap_or(usize::MAX)
        && attempts.iter().all(|a| a.outcome == Outcome::TargetFailure)
    {
        Outcome::TargetFailure
    } else {
        Outcome::Unknown
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attempt(outcome: Outcome) -> AttemptResult {
        AttemptResult {
            outcome,
            cause: Cause::Ok,
            phase: ProtocolPhase::Connect,
            elapsed_ms: U53::ONE,
            latency_us: None,
        }
    }

    #[test]
    fn one_round_one_vote() {
        use Outcome::{ConfigurationError, Success, TargetFailure, Unknown};
        let tf = || attempt(TargetFailure);
        assert_eq!(round_outcome(&[tf(), attempt(Success)], 2), Success);
        assert_eq!(round_outcome(&[tf(), tf()], 2), TargetFailure);
        // The budget ran out with a retry still configured: no vote.
        assert_eq!(round_outcome(&[tf()], 2), Unknown);
        assert_eq!(round_outcome(&[tf(), attempt(Unknown)], 2), Unknown);
        assert_eq!(
            round_outcome(&[tf(), attempt(ConfigurationError)], 2),
            ConfigurationError
        );
        assert_eq!(round_outcome(&[], 1), Unknown);
        assert!(!Unknown.is_vote() && !ConfigurationError.is_vote());
    }

    fn check(role: CheckRole, action: HealthAction) -> HealthCheck {
        serde_json::from_value(serde_json::json!({
            "installId": "i", "orgId": "o", "id": "c", "revision": 1, "subjectId": "s",
            "role": role, "vantage": "outside",
            "probe": {"kind": "tcp", "host": "example.com", "port": 443},
            "intervalMs": 60000, "attemptTimeoutMs": 5000, "retries": 1, "retryBackoffMs": 1000,
            "roundBudgetMs": 15000, "startPeriodMs": 0, "failureThreshold": 1,
            "successThreshold": 1, "readyHoldMs": 0, "degradedAfterMs": 2000,
            "healthAction": action, "outcomePolicyRevision": 1
        }))
        .unwrap()
    }

    #[test]
    fn restart_only_on_liveness_and_budget_arithmetic() {
        assert_eq!(
            check(CheckRole::Uptime, HealthAction::None).validate(),
            Ok(())
        );
        assert_eq!(
            check(CheckRole::Readiness, HealthAction::Restart).validate(),
            Err(CheckIssue::RestartRequiresLiveness)
        );
        assert_eq!(
            check(CheckRole::Liveness, HealthAction::Restart).validate(),
            Ok(())
        );
        // Default: 2×5 s + 1 s + 4 s = 15 s exactly fits.
        let c = check(CheckRole::Uptime, HealthAction::None);
        assert_eq!(c.minimum_round_budget_ms(), 15_000);
        assert_eq!(c.weight_millis(), 250);
        let mut tight = c.clone();
        tight.round_budget_ms = U53::from_const(14_999);
        assert_eq!(tight.validate(), Err(CheckIssue::RoundBudgetTooShort));
        let mut fast = c;
        fast.interval_ms = U53::from_const(15_000);
        assert_eq!(
            fast.validate(),
            Err(CheckIssue::RoundBudgetNotBelowInterval)
        );
    }
}
