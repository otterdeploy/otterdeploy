//! Worst-case probe admission.
//!
//! A check is admitted by what its worst round can occupy, not by how many
//! checks there are or how fast they usually answer. For a check with
//! interval `I`, `a` attempts of timeout `t`, backoff `b` between them and a
//! bounded setup/teardown overhead `o`, its round budget `B` must cover
//! `a·t + (a−1)·b + o` and stay below `I`. The whole `B` is charged: the
//! round holds its slot through retries and backoff, so an outage in which
//! every target times out costs exactly what was admitted.
//!
//! Two pools share the executor's slots. User checks are admitted while the
//! sum of their weights `B/I` stays within the pool's weight limit (22 of 28
//! slots on a monitor, leaving 6 as headroom); the control pool is reserved
//! for platform readiness and connectivity probes and user checks never
//! consume it.
//!
//! Average utilisation does not prove that rounds with mixed intervals can
//! all start on time, so admission also places each check on a phased
//! one-hour calendar: every round of every admitted check gets a fixed start
//! second, and at no second do more rounds hold a slot than the pool has.
//! Intervals are therefore restricted to whole multiples of 30 s that divide
//! an hour, so the calendar repeats exactly every hour.
//!
//! Admission never lengthens an interval on its own: a refusal says why and,
//! where one exists, which longer interval would fit.

use serde::Serialize;
use std::collections::BTreeMap;
use std::fmt;
use std::time::Duration;

/// The calendar's period, seconds. Every admissible interval divides it.
pub const HYPERPERIOD_S: u32 = 3_600;
/// Shortest and longest admissible intervals, seconds.
pub const MIN_INTERVAL_S: u32 = 30;
pub const MAX_INTERVAL_S: u32 = 3_600;

/// Probe-slot weight in thousandths of a slot. Integer so that admission is
/// exact and order-independent.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
pub struct Weight(pub u32);

impl Weight {
    pub const fn slots(slots: u32) -> Self {
        Self(slots * 1_000)
    }
}

impl fmt::Display for Weight {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{:03}", self.0 / 1_000, self.0 % 1_000)
    }
}

/// How one check's rounds are run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct RoundSpec {
    pub interval: Duration,
    pub attempts: u8,
    /// Per attempt, including name resolution, connect, TLS and body.
    pub attempt_timeout: Duration,
    pub backoff: Duration,
    /// Bounded setup and teardown around the attempts.
    pub overhead: Duration,
    /// The slot reservation charged for every round.
    pub budget: Duration,
}

impl RoundSpec {
    /// Uptime default: every 60 s, a 5 s attempt plus one retry after 1 s,
    /// a 15 s round budget (2×5 + 1 plus up to 4 s of overhead).
    pub const UPTIME_DEFAULT: Self = Self {
        interval: Duration::from_secs(60),
        attempts: 2,
        attempt_timeout: Duration::from_secs(5),
        backoff: Duration::from_secs(1),
        overhead: Duration::from_secs(4),
        budget: Duration::from_secs(15),
    };

    /// Platform control stream: every 30 s, one 5 s attempt, 6 s reserved.
    pub const CONTROL_DEFAULT: Self = Self {
        interval: Duration::from_secs(30),
        attempts: 1,
        attempt_timeout: Duration::from_secs(5),
        backoff: Duration::ZERO,
        overhead: Duration::from_secs(1),
        budget: Duration::from_secs(6),
    };

    /// `a·t + (a−1)·b + o`.
    pub fn required_budget(&self) -> Duration {
        let a = u32::from(self.attempts);
        self.attempt_timeout * a + self.backoff * a.saturating_sub(1) + self.overhead
    }

    /// # Errors
    /// The spec cannot be run as a bounded, calendar-aligned round.
    pub fn validate(&self) -> Result<(), SpecError> {
        if self.attempts == 0 {
            return Err(SpecError::NoAttempts);
        }
        if self.attempt_timeout.is_zero() {
            return Err(SpecError::ZeroTimeout);
        }
        let interval_s = whole_seconds(self.interval).ok_or(SpecError::IntervalNotOnCalendar)?;
        if !(MIN_INTERVAL_S..=MAX_INTERVAL_S).contains(&interval_s) {
            return Err(SpecError::IntervalOutOfRange);
        }
        if !interval_s.is_multiple_of(MIN_INTERVAL_S) || !HYPERPERIOD_S.is_multiple_of(interval_s) {
            return Err(SpecError::IntervalNotOnCalendar);
        }
        let required = self.required_budget();
        if self.budget < required {
            return Err(SpecError::BudgetBelowAttempts {
                required,
                budget: self.budget,
            });
        }
        if self.budget >= self.interval {
            return Err(SpecError::BudgetNotBelowInterval);
        }
        Ok(())
    }

    /// `B/I`, rounded up to the next thousandth of a slot.
    pub fn weight(&self) -> Weight {
        weight_of(self.budget, self.interval)
    }

    /// Calendar seconds a round holds its slot: `B` rounded up.
    fn budget_ticks(&self) -> u32 {
        let ms = self.budget.as_millis();
        u32::try_from(ms.div_ceil(1_000)).unwrap_or(u32::MAX)
    }
}

fn weight_of(budget: Duration, interval: Duration) -> Weight {
    let b = budget.as_millis();
    let i = interval.as_millis().max(1);
    Weight(u32::try_from((b * 1_000).div_ceil(i)).unwrap_or(u32::MAX))
}

fn whole_seconds(d: Duration) -> Option<u32> {
    (d.subsec_nanos() == 0)
        .then(|| u32::try_from(d.as_secs()).ok())
        .flatten()
}

/// Every interval admission accepts, shortest first.
pub fn calendar_intervals() -> impl Iterator<Item = Duration> {
    (MIN_INTERVAL_S..=MAX_INTERVAL_S)
        .step_by(MIN_INTERVAL_S as usize)
        .filter(|s| HYPERPERIOD_S.is_multiple_of(*s))
        .map(|s| Duration::from_secs(u64::from(s)))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error, Serialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum SpecError {
    #[error("a check needs at least one attempt")]
    NoAttempts,
    #[error("the attempt timeout must be positive")]
    ZeroTimeout,
    #[error("the interval must be between 30 s and 1 h")]
    IntervalOutOfRange,
    #[error("the interval must be a whole multiple of 30 s that divides an hour")]
    IntervalNotOnCalendar,
    #[error("the round budget {budget:?} is below what its attempts need ({required:?})")]
    BudgetBelowAttempts {
        required: Duration,
        budget: Duration,
    },
    #[error("the round budget must be shorter than the interval")]
    BudgetNotBelowInterval,
}

/// Which slots a check runs in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Pool {
    /// Platform readiness, connectivity and scheduler health.
    Control,
    /// Everything users configure, including hairpin checks.
    User,
}

/// Physical slots and the admissible weight of one pool.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct PoolLimits {
    pub slots: u16,
    pub max_weight: Weight,
}

/// Slot split of one executor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Profile {
    pub control: PoolLimits,
    pub user: PoolLimits,
}

impl Profile {
    /// A monitor: 32 slots, 4 reserved for control (weight ≤ 3) and 28 for
    /// users (weight ≤ 22, six slots of headroom).
    pub const MONITOR: Self = Self {
        control: PoolLimits {
            slots: 4,
            max_weight: Weight::slots(3),
        },
        user: PoolLimits {
            slots: 28,
            max_weight: Weight::slots(22),
        },
    };

    pub fn limits(&self, pool: Pool) -> PoolLimits {
        match pool {
            Pool::Control => self.control,
            Pool::User => self.user,
        }
    }
}

/// A check's place on the calendar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Admitted {
    pub pool: Pool,
    pub spec: RoundSpec,
    pub weight: Weight,
    /// Offset of the check's rounds within each interval. Rounds start at
    /// `phase + k·interval` seconds past the top of every hour.
    pub phase: Duration,
}

/// Why a check was refused, and what would fit instead.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Rejection {
    pub reason: RejectReason,
    /// The shortest longer calendar interval at which the same round budget
    /// would be admitted now, if any. Offered, never applied.
    pub fits_at_interval: Option<Duration>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, Serialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum RejectReason {
    #[error("{0}")]
    InvalidSpec(SpecError),
    #[error("the check is already admitted")]
    AlreadyAdmitted,
    #[error("weight {requested} exceeds the pool's remaining {available}")]
    WeightExceeded {
        requested: Weight,
        available: Weight,
    },
    #[error("no start second keeps every round within {slots} slots (best peak {best_peak})")]
    NoFeasiblePhase { slots: u16, best_peak: u16 },
}

/// The state of one pool, as setup screens show it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PoolReport {
    pub pool: Pool,
    pub limits: PoolLimits,
    pub admitted: usize,
    pub weight_used: Weight,
    pub headroom: Weight,
    /// The most rounds holding a slot at any second of the calendar.
    pub peak_concurrent: u16,
}

#[derive(Debug)]
struct PoolState<K> {
    limits: PoolLimits,
    weight_used: Weight,
    /// Rounds holding a slot at each second of the hour.
    occupancy: Vec<u16>,
    checks: BTreeMap<K, Admitted>,
}

impl<K: Ord> PoolState<K> {
    fn new(limits: PoolLimits) -> Self {
        Self {
            limits,
            weight_used: Weight(0),
            occupancy: vec![0; HYPERPERIOD_S as usize],
            checks: BTreeMap::new(),
        }
    }

    fn ticks(spec: &RoundSpec, phase_s: u32) -> impl Iterator<Item = usize> {
        let interval = whole_seconds(spec.interval).unwrap_or(HYPERPERIOD_S);
        let hold = spec.budget_ticks();
        (0..HYPERPERIOD_S / interval).flat_map(move |k| {
            (0..hold).map(move |d| ((phase_s + k * interval + d) % HYPERPERIOD_S) as usize)
        })
    }

    /// The start second with the lowest peak, then the lowest total load,
    /// then the earliest: deterministic for a given admission order.
    fn best_phase(&self, spec: &RoundSpec) -> (u32, u16) {
        let interval = whole_seconds(spec.interval).unwrap_or(HYPERPERIOD_S);
        let mut best = (u16::MAX, u64::MAX, 0u32);
        for phase in 0..interval {
            let (mut peak, mut load) = (0u16, 0u64);
            for t in Self::ticks(spec, phase) {
                let o = self.occupancy.get(t).copied().unwrap_or(0);
                peak = peak.max(o);
                load += u64::from(o);
            }
            if (peak, load) < (best.0, best.1) {
                best = (peak, load, phase);
            }
        }
        (best.2, best.0)
    }

    fn apply(&mut self, spec: &RoundSpec, phase_s: u32, add: bool) {
        for t in Self::ticks(spec, phase_s) {
            if let Some(o) = self.occupancy.get_mut(t) {
                *o = if add {
                    o.saturating_add(1)
                } else {
                    o.saturating_sub(1)
                };
            }
        }
    }

    fn fits_at(&self, spec: &RoundSpec) -> Option<Duration> {
        let available = self.limits.max_weight.0.saturating_sub(self.weight_used.0);
        calendar_intervals()
            .filter(|i| *i > spec.interval && spec.budget < *i)
            .find(|i| weight_of(spec.budget, *i).0 <= available)
    }
}

/// Admitted checks of one executor, keyed by `K` (check, revision, vantage).
#[derive(Debug)]
pub struct Admission<K> {
    control: PoolState<K>,
    user: PoolState<K>,
}

impl<K: Ord + Clone> Admission<K> {
    pub fn new(profile: Profile) -> Self {
        Self {
            control: PoolState::new(profile.control),
            user: PoolState::new(profile.user),
        }
    }

    fn pool_mut(&mut self, pool: Pool) -> &mut PoolState<K> {
        match pool {
            Pool::Control => &mut self.control,
            Pool::User => &mut self.user,
        }
    }

    fn pool(&self, pool: Pool) -> &PoolState<K> {
        match pool {
            Pool::Control => &self.control,
            Pool::User => &self.user,
        }
    }

    /// Admit a check and place it on the calendar, or refuse it.
    ///
    /// # Errors
    /// The spec is invalid, the check is already admitted, the pool's weight
    /// limit would be exceeded, or no start second keeps every round within
    /// the pool's slots.
    pub fn admit(&mut self, key: K, pool: Pool, spec: RoundSpec) -> Result<Admitted, Rejection> {
        let refuse = |reason, fits_at_interval| Rejection {
            reason,
            fits_at_interval,
        };
        spec.validate()
            .map_err(|e| refuse(RejectReason::InvalidSpec(e), None))?;
        if self.control.checks.contains_key(&key) || self.user.checks.contains_key(&key) {
            return Err(refuse(RejectReason::AlreadyAdmitted, None));
        }
        let state = self.pool_mut(pool);
        let weight = spec.weight();
        let available = Weight(
            state
                .limits
                .max_weight
                .0
                .saturating_sub(state.weight_used.0),
        );
        if weight > available {
            return Err(refuse(
                RejectReason::WeightExceeded {
                    requested: weight,
                    available,
                },
                state.fits_at(&spec),
            ));
        }
        let (phase_s, peak) = state.best_phase(&spec);
        if peak >= state.limits.slots {
            return Err(refuse(
                RejectReason::NoFeasiblePhase {
                    slots: state.limits.slots,
                    best_peak: peak,
                },
                state.fits_at(&spec),
            ));
        }
        state.apply(&spec, phase_s, true);
        state.weight_used = Weight(state.weight_used.0 + weight.0);
        let admitted = Admitted {
            pool,
            spec,
            weight,
            phase: Duration::from_secs(u64::from(phase_s)),
        };
        state.checks.insert(key, admitted);
        Ok(admitted)
    }

    /// Release a check's reservation.
    pub fn remove(&mut self, key: &K) -> Option<Admitted> {
        for state in [&mut self.control, &mut self.user] {
            if let Some(a) = state.checks.remove(key) {
                let phase_s = whole_seconds(a.phase).unwrap_or(0);
                state.apply(&a.spec, phase_s, false);
                state.weight_used = Weight(state.weight_used.0.saturating_sub(a.weight.0));
                return Some(a);
            }
        }
        None
    }

    pub fn get(&self, key: &K) -> Option<&Admitted> {
        self.control
            .checks
            .get(key)
            .or_else(|| self.user.checks.get(key))
    }

    pub fn iter(&self) -> impl Iterator<Item = (&K, &Admitted)> {
        self.control.checks.iter().chain(self.user.checks.iter())
    }

    pub fn report(&self, pool: Pool) -> PoolReport {
        let s = self.pool(pool);
        PoolReport {
            pool,
            limits: s.limits,
            admitted: s.checks.len(),
            weight_used: s.weight_used,
            headroom: Weight(s.limits.max_weight.0.saturating_sub(s.weight_used.0)),
            peak_concurrent: s.occupancy.iter().copied().max().unwrap_or(0),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn at(secs: u64) -> RoundSpec {
        RoundSpec {
            interval: Duration::from_secs(secs),
            ..RoundSpec::UPTIME_DEFAULT
        }
    }

    fn fill(spec: RoundSpec) -> (usize, Rejection) {
        let mut adm = Admission::new(Profile::MONITOR);
        let mut n = 0usize;
        loop {
            match adm.admit(n, Pool::User, spec) {
                Ok(_) => n += 1,
                Err(r) => return (n, r),
            }
        }
    }

    #[test]
    fn default_specs_are_valid_and_weigh_what_the_design_says() {
        RoundSpec::UPTIME_DEFAULT.validate().unwrap();
        RoundSpec::CONTROL_DEFAULT.validate().unwrap();
        assert_eq!(RoundSpec::UPTIME_DEFAULT.weight(), Weight(250));
        assert_eq!(RoundSpec::CONTROL_DEFAULT.weight(), Weight(200));
    }

    #[test]
    fn ceilings_at_the_default_budget_match_the_arithmetic() {
        // 22 slots of weight / (15 s / I)
        assert_eq!(fill(at(30)).0, 44);
        assert_eq!(fill(at(60)).0, 88);
        assert_eq!(fill(at(300)).0, 440);
        assert_eq!(fill(at(600)).0, 880);
    }

    #[test]
    fn five_hundred_one_minute_checks_are_refused_not_admitted() {
        let mut adm = Admission::new(Profile::MONITOR);
        let refused = (0..500)
            .filter(|i| adm.admit(*i, Pool::User, at(60)).is_err())
            .count();
        assert_eq!(refused, 500 - 88);
        let report = adm.report(Pool::User);
        assert_eq!(report.weight_used, Weight::slots(22));
        assert!(report.peak_concurrent <= 28);
        // and the reason is the weight limit, with nothing left to offer
        let r = adm.admit(1_000, Pool::User, at(60)).unwrap_err();
        assert_eq!(
            r.reason,
            RejectReason::WeightExceeded {
                requested: Weight(250),
                available: Weight(0)
            }
        );
        assert_eq!(r.fits_at_interval, None);
    }

    #[test]
    fn user_saturation_leaves_the_control_reserve_untouched() {
        let mut adm = Admission::new(Profile::MONITOR);
        for i in 0..88 {
            adm.admit(i, Pool::User, at(60)).unwrap();
        }
        for i in 0..3 {
            adm.admit(10_000 + i, Pool::Control, RoundSpec::CONTROL_DEFAULT)
                .unwrap();
        }
        let control = adm.report(Pool::Control);
        assert_eq!(control.weight_used, Weight(600));
        assert!(control.peak_concurrent <= 1, "{control:?}");
    }

    #[test]
    fn a_refusal_offers_the_shortest_interval_that_fits() {
        let mut adm = Admission::new(Profile::MONITOR);
        // 87 one-minute checks use 21.75; a 60 s check (0.25) fits, a 30 s
        // one (0.5) does not, and the offer is the next interval with weight
        // within 0.25: 60 s.
        for i in 0..87 {
            adm.admit(i, Pool::User, at(60)).unwrap();
        }
        let r = adm.admit(500, Pool::User, at(30)).unwrap_err();
        assert_eq!(r.fits_at_interval, Some(Duration::from_secs(60)));
    }

    #[test]
    fn invalid_specs_say_why() {
        let mut adm: Admission<u32> = Admission::new(Profile::MONITOR);
        let too_tight = RoundSpec {
            budget: Duration::from_secs(10),
            ..RoundSpec::UPTIME_DEFAULT
        };
        assert!(matches!(
            adm.admit(1, Pool::User, too_tight).unwrap_err().reason,
            RejectReason::InvalidSpec(SpecError::BudgetBelowAttempts { .. })
        ));
        assert!(matches!(
            adm.admit(2, Pool::User, at(45)).unwrap_err().reason,
            RejectReason::InvalidSpec(SpecError::IntervalNotOnCalendar)
        ));
        assert!(matches!(
            adm.admit(3, Pool::User, at(7_200)).unwrap_err().reason,
            RejectReason::InvalidSpec(SpecError::IntervalOutOfRange)
        ));
        let no_room = RoundSpec {
            interval: Duration::from_secs(30),
            attempts: 3,
            attempt_timeout: Duration::from_secs(9),
            backoff: Duration::from_secs(1),
            overhead: Duration::from_secs(1),
            budget: Duration::from_secs(30),
        };
        assert!(matches!(
            adm.admit(4, Pool::User, no_room).unwrap_err().reason,
            RejectReason::InvalidSpec(SpecError::BudgetNotBelowInterval)
        ));
    }

    #[test]
    fn removing_a_check_returns_its_capacity() {
        let mut adm = Admission::new(Profile::MONITOR);
        for i in 0..88 {
            adm.admit(i, Pool::User, at(60)).unwrap();
        }
        assert!(adm.admit(88, Pool::User, at(60)).is_err());
        adm.remove(&3).unwrap();
        adm.admit(88, Pool::User, at(60)).unwrap();
        assert_eq!(adm.report(Pool::User).admitted, 88);
    }

    #[test]
    fn calendar_intervals_divide_the_hour() {
        let all: Vec<u64> = calendar_intervals().map(|d| d.as_secs()).collect();
        assert_eq!(
            all,
            [
                30, 60, 90, 120, 150, 180, 240, 300, 360, 450, 600, 720, 900, 1200, 1800, 3600
            ]
        );
    }

    fn any_spec() -> impl Strategy<Value = RoundSpec> {
        let intervals: Vec<u64> = calendar_intervals().map(|d| d.as_secs()).collect();
        (
            proptest::sample::select(intervals),
            1u8..=3,
            1u64..=10,
            0u64..=2,
        )
            .prop_filter_map(
                "budget must fit below the interval",
                |(interval, attempts, timeout, backoff)| {
                    let mut spec = RoundSpec {
                        interval: Duration::from_secs(interval),
                        attempts,
                        attempt_timeout: Duration::from_secs(timeout),
                        backoff: Duration::from_secs(backoff),
                        overhead: Duration::from_secs(1),
                        budget: Duration::ZERO,
                    };
                    spec.budget = spec.required_budget();
                    spec.validate().ok().map(|()| spec)
                },
            )
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(64))]

        /// Whatever is admitted, in whatever order, with removals mixed in:
        /// the weight limit holds, no second of the calendar has more rounds
        /// holding a slot than the pool has slots, and the calendar is
        /// exactly the sum of the admitted checks' rounds.
        #[test]
        fn calendar_never_oversubscribes(
            ops in proptest::collection::vec((any_spec(), any::<bool>(), 0usize..40), 1..120),
        ) {
            let mut adm = Admission::new(Profile::MONITOR);
            for (i, (spec, remove, victim)) in ops.into_iter().enumerate() {
                if remove {
                    adm.remove(&victim);
                } else {
                    let _ = adm.admit(i, Pool::User, spec);
                }
                let r = adm.report(Pool::User);
                prop_assert!(r.weight_used <= Weight::slots(22));
                prop_assert!(r.peak_concurrent <= 28);
            }
            let mut expected = vec![0u16; HYPERPERIOD_S as usize];
            for (_, a) in adm.iter() {
                for t in PoolState::<usize>::ticks(&a.spec, whole_seconds(a.phase).unwrap()) {
                    expected[t] += 1;
                }
            }
            prop_assert_eq!(&expected, &adm.user.occupancy);
            let total: u32 = adm.iter().map(|(_, a)| a.weight.0).sum();
            prop_assert_eq!(total, adm.report(Pool::User).weight_used.0);
        }
    }
}
