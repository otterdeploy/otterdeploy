//! Protocol adapters: run one attempt of a probe and say what it measured.
//!
//! Every adapter is plain async code over tokio sockets with no internal
//! timers of its own besides the resolver's; [`run_attempt`] puts the
//! attempt timeout around it. Dropping the future closes its sockets, so an
//! attempt that hits its deadline is contained and frees its slot at once.
//!
//! The deadline is also qualified: if the timer that ends an attempt fires
//! well after it was due, the executor itself stalled (CPU starvation, a
//! blocked runtime), and the timeout is reported as Unknown
//! (`executor_overloaded`), not as the target timing out.

mod dns;
mod resolve;
mod tcp;

pub use resolve::Resolver;

use crate::outcome::{Attempt, ConfigCause, Phase, TargetCause, UnknownCause};
use crate::spec::ProbeSpec;
use serde::Serialize;
use std::io;
use std::sync::Arc;
use std::sync::atomic::{AtomicU8, Ordering};
use std::time::{Duration, Instant, SystemTime};

/// How late a deadline timer may fire before the executor counts as stalled.
pub const TIMER_SLACK: Duration = Duration::from_millis(500);

/// The leaf certificate an attempt saw.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct CertificateInfo {
    /// Unix seconds.
    pub not_after: i64,
    /// Whether chain and hostname were verified (`false` when the check
    /// skips verification).
    pub verified: bool,
}

impl CertificateInfo {
    /// Whole days until expiry, negative once expired.
    pub fn days_remaining(&self, now: SystemTime) -> i64 {
        let now = now
            .duration_since(SystemTime::UNIX_EPOCH)
            .map_or(0, |d| i64::try_from(d.as_secs()).unwrap_or(i64::MAX));
        (self.not_after - now).div_euclid(86_400)
    }
}

/// One attempt's result plus what it learned on the way.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AttemptOutput {
    pub attempt: Attempt,
    pub certificate: Option<CertificateInfo>,
}

impl From<Attempt> for AttemptOutput {
    fn from(attempt: Attempt) -> Self {
        Self {
            attempt,
            certificate: None,
        }
    }
}

/// The phase an attempt is in, readable after its future was dropped.
#[derive(Debug, Clone, Default)]
pub struct Progress(Arc<AtomicU8>);

impl Progress {
    pub fn set(&self, phase: Phase) {
        self.0.store(phase_code(phase), Ordering::Relaxed);
    }

    pub fn get(&self) -> Phase {
        code_phase(self.0.load(Ordering::Relaxed))
    }
}

fn phase_code(p: Phase) -> u8 {
    match p {
        Phase::Schedule => 0,
        Phase::Resolve => 1,
        Phase::Connect => 2,
        Phase::TlsHandshake => 3,
        Phase::Request => 4,
        Phase::Response => 5,
        Phase::Assert => 6,
    }
}

fn code_phase(c: u8) -> Phase {
    match c {
        1 => Phase::Resolve,
        2 => Phase::Connect,
        3 => Phase::TlsHandshake,
        4 => Phase::Request,
        5 => Phase::Response,
        6 => Phase::Assert,
        _ => Phase::Schedule,
    }
}

/// What every adapter gets for one attempt.
#[derive(Debug, Clone)]
pub struct AttemptCtx {
    pub started: Instant,
    pub deadline: Instant,
    pub progress: Progress,
    pub resolver: Arc<Resolver>,
}

impl AttemptCtx {
    pub fn failure(&self, cause: TargetCause) -> Attempt {
        Attempt::TargetFailure {
            cause,
            phase: self.progress.get(),
            elapsed: self.started.elapsed(),
        }
    }

    pub fn unknown(&self, cause: UnknownCause) -> Attempt {
        Attempt::Unknown {
            cause,
            phase: self.progress.get(),
        }
    }

    pub fn success(&self) -> Attempt {
        Attempt::Success {
            latency: self.started.elapsed(),
        }
    }
}

/// Run one attempt of `probe` with `timeout`.
pub async fn run_attempt(
    probe: &ProbeSpec,
    resolver: Arc<Resolver>,
    timeout: Duration,
) -> AttemptOutput {
    let started = Instant::now();
    let ctx = AttemptCtx {
        started,
        deadline: started + timeout,
        progress: Progress::default(),
        resolver,
    };
    let deadline = tokio::time::Instant::from_std(ctx.deadline);
    if let Ok(output) = tokio::time::timeout_at(deadline, dispatch(probe, &ctx)).await {
        return output;
    }
    let late = Instant::now().saturating_duration_since(ctx.deadline);
    if late > TIMER_SLACK {
        ctx.unknown(UnknownCause::ExecutorOverloaded).into()
    } else {
        ctx.failure(TargetCause::TargetTimeout).into()
    }
}

async fn dispatch(probe: &ProbeSpec, ctx: &AttemptCtx) -> AttemptOutput {
    match probe {
        ProbeSpec::Tcp { host, port } => tcp::probe(host, *port, ctx).await.into(),
        ProbeSpec::Dns(spec) => dns::probe(spec, ctx).await.into(),
        // Adapters for these protocols land separately; until then the
        // check cannot run here and says so.
        ProbeSpec::Http(_) | ProbeSpec::Tls(_) | ProbeSpec::Icmp { .. } => {
            Attempt::ConfigurationError {
                cause: ConfigCause::Unsupported,
            }
            .into()
        }
    }
}

/// `EMFILE` / `ENFILE`: this process or the system is out of descriptors.
const EMFILE: i32 = 24;
const ENFILE: i32 = 23;

/// Map a socket error seen while talking to the target. Errors about the
/// target or the path to it are measured failures; errors about our own
/// resources are Unknown.
pub fn classify_io(err: &io::Error, ctx: &AttemptCtx) -> Attempt {
    use io::ErrorKind as K;
    if matches!(err.raw_os_error(), Some(EMFILE | ENFILE)) {
        return ctx.unknown(UnknownCause::ExecutorFailure);
    }
    match err.kind() {
        K::ConnectionRefused => ctx.failure(TargetCause::ConnectionRefused),
        K::HostUnreachable | K::NetworkUnreachable => ctx.failure(TargetCause::TargetUnreachable),
        K::ConnectionReset | K::ConnectionAborted | K::BrokenPipe | K::UnexpectedEof => {
            ctx.failure(TargetCause::ConnectionReset)
        }
        K::TimedOut => ctx.failure(TargetCause::TargetTimeout),
        K::InvalidData => ctx.failure(TargetCause::ProtocolError),
        K::PermissionDenied => Attempt::ConfigurationError {
            cause: ConfigCause::PermissionMissing,
        },
        _ => ctx.unknown(UnknownCause::ExecutorFailure),
    }
}

/// Strip the brackets URLs put around IPv6 literals.
pub(crate) fn bare_host(host: &str) -> &str {
    host.strip_prefix('[')
        .and_then(|h| h.strip_suffix(']'))
        .unwrap_or(host)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> AttemptCtx {
        let now = Instant::now();
        AttemptCtx {
            started: now,
            deadline: now + Duration::from_secs(5),
            progress: Progress::default(),
            resolver: Arc::new(Resolver::new(Vec::new())),
        }
    }

    #[test]
    fn target_errors_are_failures_and_local_errors_are_unknown() {
        let c = ctx();
        c.progress.set(Phase::Connect);
        let refused = io::Error::from(io::ErrorKind::ConnectionRefused);
        assert!(matches!(
            classify_io(&refused, &c),
            Attempt::TargetFailure {
                cause: TargetCause::ConnectionRefused,
                phase: Phase::Connect,
                ..
            }
        ));
        let unreachable = io::Error::from(io::ErrorKind::HostUnreachable);
        assert!(matches!(
            classify_io(&unreachable, &c),
            Attempt::TargetFailure {
                cause: TargetCause::TargetUnreachable,
                ..
            }
        ));
        let out_of_fds = io::Error::from_raw_os_error(EMFILE);
        assert!(matches!(
            classify_io(&out_of_fds, &c),
            Attempt::Unknown {
                cause: UnknownCause::ExecutorFailure,
                ..
            }
        ));
        let denied = io::Error::from(io::ErrorKind::PermissionDenied);
        assert!(matches!(
            classify_io(&denied, &c),
            Attempt::ConfigurationError {
                cause: ConfigCause::PermissionMissing
            }
        ));
    }

    #[test]
    fn progress_survives_the_attempt() {
        let p = Progress::default();
        assert_eq!(p.get(), Phase::Schedule);
        p.set(Phase::TlsHandshake);
        assert_eq!(p.clone().get(), Phase::TlsHandshake);
    }

    #[test]
    fn days_remaining_counts_down_and_goes_negative() {
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        let cert = CertificateInfo {
            not_after: 1_000_000 + 10 * 86_400 + 5,
            verified: true,
        };
        assert_eq!(cert.days_remaining(now), 10);
        let expired = CertificateInfo {
            not_after: 1_000_000 - 1,
            verified: true,
        };
        assert_eq!(expired.days_remaining(now), -1);
    }

    #[test]
    fn ipv6_brackets_are_stripped() {
        assert_eq!(bare_host("[::1]"), "::1");
        assert_eq!(bare_host("example.com"), "example.com");
    }
}
