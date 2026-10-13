//! The session's bounded wall clock.
//!
//! A reading pairs the control plane's wall clock with the node's
//! `CLOCK_BOOTTIME` at the midpoint of the round trip that carried it, with
//! half the round trip as uncertainty. Between readings the bound widens by a
//! drift allowance, and after `max_age` without a fresh reading it is gone:
//! the node then refuses new privileged work rather than fall back on its own
//! clock.

use otterd_proto::U53;
use otterd_proto::capability::ClockBound;
use std::time::Duration;

/// Allowed drift between the node's monotonic clock and the control plane's
/// wall clock, in parts per million.
pub const DRIFT_PPM: u64 = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionClock {
    cp_unix_ms: u64,
    uncertainty_ms: u64,
    /// Boot-clock instant the reading refers to.
    anchor: Duration,
    max_age: Duration,
}

fn ms(d: Duration) -> u64 {
    u64::try_from(d.as_millis()).unwrap_or(u64::MAX)
}

impl SessionClock {
    /// A reading from a round trip sent at `sent` and answered at `received`
    /// (both boot-clock), carrying the control plane's `cp_unix_ms`.
    #[must_use]
    pub fn from_round_trip(
        sent: Duration,
        received: Duration,
        cp_unix_ms: U53,
        max_age: Duration,
    ) -> Self {
        let rtt = received.saturating_sub(sent);
        let half = rtt / 2;
        Self {
            cp_unix_ms: cp_unix_ms.get(),
            uncertainty_ms: ms(rtt).div_ceil(2),
            anchor: sent + half,
            max_age,
        }
    }

    /// The bound at boot-clock instant `mono`, or `None` once the reading is
    /// older than `max_age`.
    #[must_use]
    pub fn at(&self, mono: Duration) -> Option<ClockBound> {
        let elapsed = mono.checked_sub(self.anchor).unwrap_or_default();
        if elapsed > self.max_age {
            return None;
        }
        let elapsed_ms = ms(elapsed);
        let drift = (elapsed_ms.saturating_mul(DRIFT_PPM)).div_ceil(1_000_000);
        Some(ClockBound {
            now_unix_ms: U53::new(self.cp_unix_ms.saturating_add(elapsed_ms))?,
            uncertainty_ms: U53::new(self.uncertainty_ms.saturating_add(drift))?,
        })
    }

    /// The bound now.
    #[must_use]
    pub fn now(&self) -> Option<ClockBound> {
        self.at(otterd_sys::host::boottime())
    }

    /// Keep whichever reading gives the tighter bound at `mono`.
    #[must_use]
    pub fn refine(self, newer: Self, mono: Duration) -> Self {
        match (self.at(mono), newer.at(mono)) {
            (Some(old), Some(new)) if old.uncertainty_ms < new.uncertainty_ms => self,
            _ => newer,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: fn(u64) -> Duration = Duration::from_secs;

    #[test]
    fn bound_widens_with_age_and_expires() {
        let c = SessionClock::from_round_trip(
            Duration::from_secs(1),
            Duration::from_millis(1_080),
            U53::from_const(5_000_000),
            S(60),
        );
        let b = c.at(Duration::from_millis(1_040)).unwrap();
        assert_eq!(
            (b.now_unix_ms.get(), b.uncertainty_ms.get()),
            (5_000_000, 40)
        );
        let later = c.at(Duration::from_millis(1_040) + S(30)).unwrap();
        assert_eq!(later.now_unix_ms.get(), 5_030_000);
        assert_eq!(later.uncertainty_ms.get(), 40 + 15, "500 ppm of 30 s");
        assert!(
            c.at(Duration::from_millis(1_041) + S(60)).is_none(),
            "too old"
        );
    }

    #[test]
    fn refine_keeps_the_tighter_reading() {
        let wide = SessionClock::from_round_trip(S(10), S(12), U53::from_const(1_000_000), S(60));
        let tight = SessionClock::from_round_trip(
            S(20),
            S(20) + Duration::from_millis(10),
            U53::from_const(1_010_000),
            S(60),
        );
        let now = S(21);
        assert_eq!(wide.refine(tight, now), tight);
        assert_eq!(tight.refine(wide, now), tight);
    }
}
