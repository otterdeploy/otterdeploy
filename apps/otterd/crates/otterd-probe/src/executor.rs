//! The scheduler that runs admitted checks on their calendar.
//!
//! Each admitted check's rounds are due at `origin + phase + k·interval`.
//! When a round is due the executor takes a slot from the check's pool and
//! runs the attempts inside the round's budget `[due, due + B)`:
//!
//! - an attempt only starts if its whole timeout fits before the round's
//!   end, so a target timeout is always a full, measured timeout;
//! - attempts that do not fit are missing, which makes the round Unknown,
//!   never a failure;
//! - a round that cannot start on time (no free slot, or the scheduler ran
//!   late past the check's setup allowance) is recorded as Unknown
//!   `probe_capacity` and counted, so a stalled or saturated executor shows
//!   up as a capacity alarm, not as targets failing;
//! - rounds missed entirely while the scheduler was stalled are recorded the
//!   same way, one per missed occurrence.
//!
//! Admission guarantees that admitted checks never need more slots than the
//! pool has, even if every target times out on every attempt; the counters
//! in [`ExecutorStats`] show when reality disagrees.

use crate::adapter::{AttemptOutput, CertificateInfo, Resolver, run_attempt};
use crate::admission::{Admission, Admitted, Pool, PoolReport, Profile, Rejection, RoundSpec};
use crate::outcome::{Attempt, HealthState, Phase, RoundOutcome, UnknownCause, fold};
use crate::spec::ProbeSpec;
use serde::Serialize;
use std::collections::HashMap;
use std::future::Future;
use std::hash::Hash;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};
use tokio::sync::{Semaphore, mpsc, oneshot};
use tokio::time::Instant;

/// Runs one attempt of a check. Implemented for real probes by [`Probe`];
/// tests substitute their own.
pub trait Prober: Send + Sync + 'static {
    fn attempt(&self, timeout: Duration) -> impl Future<Output = AttemptOutput> + Send;
}

/// A protocol probe and the resolver it uses for names.
#[derive(Debug, Clone)]
pub struct Probe {
    pub spec: ProbeSpec,
    pub resolver: Arc<Resolver>,
}

impl Prober for Probe {
    fn attempt(&self, timeout: Duration) -> impl Future<Output = AttemptOutput> + Send {
        run_attempt(&self.spec, self.resolver.clone(), timeout)
    }
}

/// One check as the executor runs it.
#[derive(Debug)]
pub struct Check<P> {
    pub prober: Arc<P>,
    pub round: RoundSpec,
    /// A success slower than this is Degraded.
    pub degraded_after: Option<Duration>,
}

/// One round's result: the vote, every attempt behind it, and when it ran.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RoundRecord<K> {
    pub key: K,
    pub pool: Pool,
    /// Rounds of this check since it was admitted, from 0.
    pub round_seq: u64,
    /// Unix milliseconds when the round started (or was found missed).
    pub observed_at_ms: u64,
    /// How late after its calendar slot the round started.
    #[serde(with = "millis")]
    pub started_late: Duration,
    pub attempts: Vec<Attempt>,
    /// Monotonic time the round took, from its first attempt to its vote.
    #[serde(with = "millis")]
    pub elapsed: Duration,
    pub outcome: RoundOutcome,
    pub state: HealthState,
    pub certificate: Option<CertificateInfo>,
}

/// Counters behind the `probe_capacity` alarm.
#[derive(Debug, Default)]
pub struct ExecutorStats {
    pub rounds: AtomicU64,
    /// Rounds that found no free slot in their pool.
    pub no_slot: AtomicU64,
    /// Rounds that started past their setup allowance, or were missed.
    pub late: AtomicU64,
    /// Rounds whose attempts did not all fit in the budget.
    pub budget_exceeded: AtomicU64,
    /// Attempts whose deadline timer fired late.
    pub overloaded_attempts: AtomicU64,
    /// Records the consumer did not take in time.
    pub records_dropped: AtomicU64,
}

/// A copy of [`ExecutorStats`] at one moment.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct StatsSnapshot {
    pub rounds: u64,
    pub no_slot: u64,
    pub late: u64,
    pub budget_exceeded: u64,
    pub overloaded_attempts: u64,
    pub records_dropped: u64,
}

impl ExecutorStats {
    pub fn snapshot(&self) -> StatsSnapshot {
        let r = |a: &AtomicU64| a.load(Ordering::Relaxed);
        StatsSnapshot {
            rounds: r(&self.rounds),
            no_slot: r(&self.no_slot),
            late: r(&self.late),
            budget_exceeded: r(&self.budget_exceeded),
            overloaded_attempts: r(&self.overloaded_attempts),
            records_dropped: r(&self.records_dropped),
        }
    }

    /// Whether anything happened that the capacity alarm reports.
    pub fn capacity_alarm(&self) -> bool {
        let s = self.snapshot();
        s.no_slot + s.late + s.budget_exceeded + s.overloaded_attempts + s.records_dropped > 0
    }
}

#[derive(Debug)]
struct Entry<P> {
    check: Check<P>,
    admitted: Admitted,
    next_due: Instant,
    seq: u64,
}

/// Changes and questions for a running executor.
#[derive(Debug)]
pub enum Command<K, P> {
    Admit {
        key: K,
        pool: Pool,
        check: Check<P>,
        reply: oneshot::Sender<Result<Admitted, Rejection>>,
    },
    Remove {
        key: K,
        reply: oneshot::Sender<Option<Admitted>>,
    },
    Report {
        pool: Pool,
        reply: oneshot::Sender<PoolReport>,
    },
}

#[derive(Debug)]
pub struct Executor<K, P> {
    admission: Admission<K>,
    entries: HashMap<K, Entry<P>>,
    control_slots: Arc<Semaphore>,
    user_slots: Arc<Semaphore>,
    stats: Arc<ExecutorStats>,
    origin: Instant,
}

impl<K, P> Executor<K, P>
where
    K: Ord + Hash + Clone + Send + Sync + 'static,
    P: Prober,
{
    pub fn new(profile: Profile) -> Self {
        Self {
            admission: Admission::new(profile),
            entries: HashMap::new(),
            control_slots: Arc::new(Semaphore::new(usize::from(profile.control.slots))),
            user_slots: Arc::new(Semaphore::new(usize::from(profile.user.slots))),
            stats: Arc::new(ExecutorStats::default()),
            origin: Instant::now(),
        }
    }

    pub fn stats(&self) -> Arc<ExecutorStats> {
        self.stats.clone()
    }

    /// Admit a check onto the calendar.
    ///
    /// # Errors
    /// The admission refusal, unchanged.
    pub fn admit(&mut self, key: K, pool: Pool, check: Check<P>) -> Result<Admitted, Rejection> {
        let admitted = self.admission.admit(key.clone(), pool, check.round)?;
        let next_due = self.first_due(&admitted);
        self.entries.insert(
            key,
            Entry {
                check,
                admitted,
                next_due,
                seq: 0,
            },
        );
        Ok(admitted)
    }

    pub fn remove(&mut self, key: &K) -> Option<Admitted> {
        self.entries.remove(key);
        self.admission.remove(key)
    }

    pub fn report(&self, pool: Pool) -> PoolReport {
        self.admission.report(pool)
    }

    /// The first calendar slot of this check that is not in the past.
    fn first_due(&self, a: &Admitted) -> Instant {
        let now = Instant::now();
        let mut due = self.origin + a.phase;
        if due < now {
            let behind = now - due;
            let periods = behind
                .as_nanos()
                .div_ceil(a.spec.interval.as_nanos().max(1));
            let periods = u32::try_from(periods).unwrap_or(u32::MAX);
            due += a.spec.interval * periods;
        }
        due
    }

    /// Run until the command channel closes. Rounds are sent to `records`;
    /// a full channel drops the record and counts it.
    pub async fn run(
        mut self,
        records: mpsc::Sender<RoundRecord<K>>,
        mut commands: mpsc::Receiver<Command<K, P>>,
    ) {
        loop {
            let next = self.entries.values().map(|e| e.next_due).min();
            let sleep = async {
                match next {
                    Some(at) => tokio::time::sleep_until(at).await,
                    None => std::future::pending().await,
                }
            };
            tokio::select! {
                () = sleep => self.fire_due(&records),
                cmd = commands.recv() => match cmd {
                    None => return,
                    Some(cmd) => self.apply(cmd),
                },
            }
        }
    }

    fn apply(&mut self, cmd: Command<K, P>) {
        match cmd {
            Command::Admit {
                key,
                pool,
                check,
                reply,
            } => {
                let _ = reply.send(self.admit(key, pool, check));
            }
            Command::Remove { key, reply } => {
                let _ = reply.send(self.remove(&key));
            }
            Command::Report { pool, reply } => {
                let _ = reply.send(self.report(pool));
            }
        }
    }

    fn fire_due(&mut self, records: &mpsc::Sender<RoundRecord<K>>) {
        let now = Instant::now();
        for (key, entry) in &mut self.entries {
            let interval = entry.admitted.spec.interval;
            // Occurrences missed entirely while the scheduler was not running.
            while entry.next_due + interval <= now {
                let late = now - entry.next_due;
                emit(records, &self.stats, unstarted(key, entry, late));
                entry.next_due += interval;
            }
            if entry.next_due > now {
                continue;
            }
            let due = entry.next_due;
            entry.next_due += interval;
            let late = now - due;
            let spec = entry.admitted.spec;
            if late > setup_allowance(&spec) {
                emit(records, &self.stats, unstarted(key, entry, late));
                continue;
            }
            let slots = match entry.admitted.pool {
                Pool::Control => &self.control_slots,
                Pool::User => &self.user_slots,
            };
            let Ok(permit) = slots.clone().try_acquire_owned() else {
                self.stats.no_slot.fetch_add(1, Ordering::Relaxed);
                emit(records, &self.stats, unstarted(key, entry, late));
                continue;
            };
            let round = RoundRun {
                key: key.clone(),
                pool: entry.admitted.pool,
                seq: entry.seq,
                spec,
                degraded_after: entry.check.degraded_after,
                prober: entry.check.prober.clone(),
                deadline: due + spec.budget,
                late,
            };
            entry.seq += 1;
            let records = records.clone();
            let stats = self.stats.clone();
            tokio::spawn(async move {
                let record = round.run(&stats).await;
                drop(permit);
                emit(&records, &stats, record);
            });
        }
    }
}

/// How late a round may start and still be run: its declared setup
/// overhead, which the budget already reserves.
fn setup_allowance(spec: &RoundSpec) -> Duration {
    spec.overhead
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// A round that never got to run: Unknown, with the capacity cause.
fn unstarted<K: Clone, P>(key: &K, entry: &mut Entry<P>, late: Duration) -> RoundRecord<K> {
    let attempt = Attempt::Unknown {
        cause: UnknownCause::ProbeCapacity,
        phase: Phase::Schedule,
    };
    let outcome = RoundOutcome::Unknown {
        cause: UnknownCause::ProbeCapacity,
    };
    let seq = entry.seq;
    entry.seq += 1;
    RoundRecord {
        key: key.clone(),
        pool: entry.admitted.pool,
        round_seq: seq,
        observed_at_ms: now_ms(),
        started_late: late,
        attempts: vec![attempt],
        elapsed: Duration::ZERO,
        state: HealthState::of(&outcome, None),
        outcome,
        certificate: None,
    }
}

fn emit<K>(records: &mpsc::Sender<RoundRecord<K>>, stats: &ExecutorStats, record: RoundRecord<K>) {
    stats.rounds.fetch_add(1, Ordering::Relaxed);
    if record.started_late > Duration::ZERO
        && matches!(
            record.outcome,
            RoundOutcome::Unknown {
                cause: UnknownCause::ProbeCapacity
            }
        )
        && record.attempts.len() == 1
    {
        stats.late.fetch_add(1, Ordering::Relaxed);
    }
    if records.try_send(record).is_err() {
        stats.records_dropped.fetch_add(1, Ordering::Relaxed);
    }
}

struct RoundRun<K, P> {
    key: K,
    pool: Pool,
    seq: u64,
    spec: RoundSpec,
    degraded_after: Option<Duration>,
    prober: Arc<P>,
    deadline: Instant,
    late: Duration,
}

impl<K, P: Prober> RoundRun<K, P> {
    async fn run(self, stats: &ExecutorStats) -> RoundRecord<K> {
        let observed_at_ms = now_ms();
        let started = Instant::now();
        let mut attempts = Vec::with_capacity(usize::from(self.spec.attempts));
        let mut certificate = None;
        for i in 0..self.spec.attempts {
            if i > 0 {
                tokio::time::sleep(self.spec.backoff).await;
            }
            if Instant::now() + self.spec.attempt_timeout > self.deadline {
                break;
            }
            let out = self.prober.attempt(self.spec.attempt_timeout).await;
            if matches!(
                out.attempt,
                Attempt::Unknown {
                    cause: UnknownCause::ExecutorOverloaded,
                    ..
                }
            ) {
                stats.overloaded_attempts.fetch_add(1, Ordering::Relaxed);
            }
            certificate = out.certificate.or(certificate);
            let is_final = out.attempt.is_final();
            attempts.push(out.attempt);
            if is_final {
                break;
            }
        }
        let outcome = fold(&attempts, self.spec.attempts);
        if matches!(
            outcome,
            RoundOutcome::Unknown {
                cause: UnknownCause::RoundBudgetExceeded
            }
        ) {
            stats.budget_exceeded.fetch_add(1, Ordering::Relaxed);
        }
        RoundRecord {
            key: self.key,
            pool: self.pool,
            round_seq: self.seq,
            observed_at_ms,
            started_late: self.late,
            attempts,
            elapsed: started.elapsed(),
            state: HealthState::of(&outcome, self.degraded_after),
            outcome,
            certificate,
        }
    }
}

mod millis {
    use serde::Serializer;
    use std::time::Duration;

    pub(super) fn serialize<S: Serializer>(d: &Duration, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_u64(u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::outcome::TargetCause;

    /// A target that never answers: every attempt is a full measured timeout.
    #[derive(Debug)]
    struct Blackhole;

    impl Prober for Blackhole {
        async fn attempt(&self, timeout: Duration) -> AttemptOutput {
            tokio::time::sleep(timeout).await;
            Attempt::TargetFailure {
                cause: TargetCause::TargetTimeout,
                phase: Phase::Connect,
                elapsed: timeout,
            }
            .into()
        }
    }

    /// A target that answers in 20 ms.
    #[derive(Debug)]
    struct Healthy;

    impl Prober for Healthy {
        async fn attempt(&self, _timeout: Duration) -> AttemptOutput {
            tokio::time::sleep(Duration::from_millis(20)).await;
            Attempt::Success {
                latency: Duration::from_millis(20),
            }
            .into()
        }
    }

    enum Either {
        Black(Blackhole),
        Up(Healthy),
    }

    impl Prober for Either {
        async fn attempt(&self, timeout: Duration) -> AttemptOutput {
            match self {
                Self::Black(b) => b.attempt(timeout).await,
                Self::Up(h) => h.attempt(timeout).await,
            }
        }
    }

    impl std::fmt::Debug for Either {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str(match self {
                Self::Black(_) => "blackhole",
                Self::Up(_) => "healthy",
            })
        }
    }

    fn check(p: Either, round: RoundSpec) -> Check<Either> {
        Check {
            prober: Arc::new(p),
            round,
            degraded_after: None,
        }
    }

    /// A full monitor in an all-target outage: 88 one-minute user checks
    /// that time out on every attempt, beside the three control streams.
    fn outage_monitor() -> Executor<u32, Either> {
        let mut ex = Executor::new(Profile::MONITOR);
        for i in 0..88 {
            ex.admit(
                i,
                Pool::User,
                check(Either::Black(Blackhole), RoundSpec::UPTIME_DEFAULT),
            )
            .unwrap();
        }
        for i in 0..3 {
            ex.admit(
                1_000 + i,
                Pool::Control,
                check(Either::Up(Healthy), RoundSpec::CONTROL_DEFAULT),
            )
            .unwrap();
        }
        ex
    }

    async fn collect(
        ex: Executor<u32, Either>,
        run_for: Duration,
    ) -> (Vec<RoundRecord<u32>>, StatsSnapshot) {
        let stats = ex.stats();
        let (tx, mut rx) = mpsc::channel(100_000);
        let (cmd_tx, cmd_rx) = mpsc::channel(1);
        let task = tokio::spawn(ex.run(tx, cmd_rx));
        tokio::time::sleep(run_for).await;
        drop(cmd_tx);
        task.await.unwrap();
        let mut out = Vec::new();
        while let Ok(r) = rx.try_recv() {
            out.push(r);
        }
        (out, stats.snapshot())
    }

    #[tokio::test(start_paused = true)]
    async fn an_admitted_outage_is_all_failure_votes_and_control_stays_on_time() {
        let (records, stats) = collect(outage_monitor(), Duration::from_secs(600)).await;
        let user: Vec<_> = records.iter().filter(|r| r.pool == Pool::User).collect();
        let control: Vec<_> = records.iter().filter(|r| r.pool == Pool::Control).collect();
        // ~10 rounds per user check; rounds still in flight at the end are not counted
        assert!(user.len() >= 88 * 9, "{}", user.len());
        assert!(control.len() >= 3 * 19, "{}", control.len());
        for r in &user {
            assert!(
                matches!(
                    r.outcome,
                    RoundOutcome::TargetFailure {
                        cause: TargetCause::TargetTimeout,
                        ..
                    }
                ),
                "{r:?}"
            );
            assert_eq!(r.attempts.len(), 2, "both attempts measured");
            assert_eq!(r.started_late, Duration::ZERO);
        }
        for r in &control {
            assert_eq!(r.state, HealthState::Healthy, "{r:?}");
            assert_eq!(r.started_late, Duration::ZERO);
        }
        assert_eq!(stats.no_slot, 0);
        assert_eq!(stats.late, 0);
        assert_eq!(stats.budget_exceeded, 0);
    }

    #[tokio::test(start_paused = true)]
    async fn a_stalled_scheduler_reports_unknown_capacity_not_failures() {
        let mut ex: Executor<u32, Either> = Executor::new(Profile::MONITOR);
        for i in 0..10 {
            ex.admit(
                i,
                Pool::User,
                check(Either::Up(Healthy), RoundSpec::UPTIME_DEFAULT),
            )
            .unwrap();
        }
        let stats = ex.stats();
        let (tx, mut rx) = mpsc::channel(100_000);
        let (cmd_tx, cmd_rx) = mpsc::channel(1);
        let task = tokio::spawn(ex.run(tx, cmd_rx));
        tokio::time::sleep(Duration::from_secs(120)).await;
        // The scheduler gets no CPU for three minutes: the clock moves on
        // without it being polled.
        let stalled = Duration::from_secs(180);
        tokio::time::advance(stalled).await;
        tokio::time::sleep(Duration::from_secs(120)).await;
        drop(cmd_tx);
        task.await.unwrap();
        let mut records = Vec::new();
        while let Ok(r) = rx.try_recv() {
            records.push(r);
        }
        assert!(
            records
                .iter()
                .all(|r| !matches!(r.outcome, RoundOutcome::TargetFailure { .. })),
            "healthy targets never fail"
        );
        let capacity = records
            .iter()
            .filter(|r| {
                r.outcome
                    == RoundOutcome::Unknown {
                        cause: UnknownCause::ProbeCapacity,
                    }
            })
            .count();
        // each check missed about three rounds during the stall
        assert!(capacity >= 10 * 2, "{capacity}");
        assert!(stats.snapshot().late >= u64::try_from(capacity).unwrap());
        assert!(stats.capacity_alarm());
    }

    #[tokio::test(start_paused = true)]
    async fn commands_admit_and_remove_while_running() {
        let ex: Executor<u32, Either> = Executor::new(Profile::MONITOR);
        let (tx, mut rx) = mpsc::channel(1_000);
        let (cmd_tx, cmd_rx) = mpsc::channel(4);
        let task = tokio::spawn(ex.run(tx, cmd_rx));
        let (reply, answer) = oneshot::channel();
        cmd_tx
            .send(Command::Admit {
                key: 7,
                pool: Pool::User,
                check: check(Either::Up(Healthy), RoundSpec::UPTIME_DEFAULT),
                reply,
            })
            .await
            .unwrap();
        answer.await.unwrap().unwrap();
        tokio::time::sleep(Duration::from_secs(185)).await;
        let (reply, answer) = oneshot::channel();
        cmd_tx
            .send(Command::Remove { key: 7, reply })
            .await
            .unwrap();
        assert!(answer.await.unwrap().is_some());
        let (reply, answer) = oneshot::channel();
        cmd_tx
            .send(Command::Report {
                pool: Pool::User,
                reply,
            })
            .await
            .unwrap();
        assert_eq!(answer.await.unwrap().admitted, 0);
        drop(cmd_tx);
        task.await.unwrap();
        let mut n = 0;
        while rx.try_recv().is_ok() {
            n += 1;
        }
        assert!((3..=4).contains(&n), "{n} rounds in 185 s at 60 s");
    }
}
