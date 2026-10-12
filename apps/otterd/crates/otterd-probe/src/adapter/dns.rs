//! DNS probes: the resolver named in the check is the target.
//!
//! Unlike name resolution for other probes, a SERVFAIL, NXDOMAIN or silence
//! from this resolver is a measured result about the target. Only failures of
//! our own socket are Unknown.

use super::AttemptCtx;
use super::resolve::{QueryError, query};
use crate::outcome::{Attempt, ConfigCause, Phase, TargetCause, UnknownCause};
use crate::spec::{DnsExpect, DnsSpec};
use hickory_proto::op::{Message, ResponseCode};
use hickory_proto::rr::{Name, RecordType};
use std::io::ErrorKind;
use std::str::FromStr;
use std::time::Instant;

/// Record types a check may ask for.
const SUPPORTED: &[&str] = &[
    "A", "AAAA", "CNAME", "MX", "TXT", "NS", "SOA", "CAA", "SRV", "PTR",
];

pub(crate) async fn probe(spec: &DnsSpec, ctx: &AttemptCtx) -> Attempt {
    let rtype_text = spec.record_type.to_ascii_uppercase();
    let rtype = match RecordType::from_str(&rtype_text) {
        Ok(r) if SUPPORTED.contains(&rtype_text.as_str()) => r,
        _ => {
            return Attempt::ConfigurationError {
                cause: ConfigCause::Unsupported,
            };
        }
    };
    let Ok(name) = Name::from_str(&spec.name) else {
        return Attempt::ConfigurationError {
            cause: ConfigCause::InvalidTarget,
        };
    };
    ctx.progress.set(Phase::Request);
    let timeout = ctx.deadline.saturating_duration_since(Instant::now());
    match query(spec.server, &name, rtype, timeout).await {
        Ok(answer) => {
            ctx.progress.set(Phase::Assert);
            judge(&spec.expect, &answer, ctx)
        }
        Err(QueryError::Timeout) => {
            ctx.progress.set(Phase::Response);
            ctx.failure(TargetCause::TargetTimeout)
        }
        Err(QueryError::Io(e)) if e.kind() == ErrorKind::ConnectionRefused => {
            ctx.failure(TargetCause::ConnectionRefused)
        }
        // A local firewall refused to send the query: this vantage is not
        // allowed to reach the resolver, as for every other protocol.
        Err(QueryError::Io(e)) if e.kind() == ErrorKind::PermissionDenied => {
            Attempt::ConfigurationError {
                cause: ConfigCause::PermissionMissing,
            }
        }
        Err(QueryError::Io(e))
            if matches!(
                e.kind(),
                ErrorKind::HostUnreachable | ErrorKind::NetworkUnreachable
            ) =>
        {
            ctx.failure(TargetCause::TargetUnreachable)
        }
        Err(QueryError::Io(_) | QueryError::Malformed) => {
            ctx.unknown(UnknownCause::ExecutorFailure)
        }
    }
}

fn judge(expect: &DnsExpect, answer: &Message, ctx: &AttemptCtx) -> Attempt {
    let code = answer.metadata.response_code;
    match (expect, code) {
        (DnsExpect::NxDomain, ResponseCode::NXDomain)
        | (DnsExpect::ServFail, ResponseCode::ServFail) => ctx.success(),
        (DnsExpect::Answer { contains }, ResponseCode::NoError) => {
            let records: Vec<String> = answer.answers.iter().map(|r| r.data.to_string()).collect();
            let found = match contains {
                None => !records.is_empty(),
                Some(want) => records
                    .iter()
                    .any(|r| r.trim_end_matches('.') == want.trim_end_matches('.')),
            };
            if found {
                ctx.success()
            } else {
                ctx.failure(TargetCause::AssertionFailed)
            }
        }
        (_, ResponseCode::ServFail) => ctx.failure(TargetCause::DnsServfail),
        (_, ResponseCode::NXDomain) => ctx.failure(TargetCause::DnsNxdomain),
        _ => ctx.failure(TargetCause::AssertionFailed),
    }
}
