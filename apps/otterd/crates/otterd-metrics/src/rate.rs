//! Turning monotonically increasing kernel counters into per-second rates.

use std::collections::HashMap;
use std::hash::Hash;
use std::time::Instant;

/// Previous reading of a set of counters, keyed by `K`.
///
/// A rate needs two readings, so the first sighting of a key yields `None`.
/// A counter that went backwards (device reset, container restart, wrap)
/// also yields `None` rather than a huge or negative number. Keys not seen in
/// a round are forgotten by [`Rates::retain_seen`].
#[derive(Debug)]
pub(crate) struct Rates<K, const N: usize> {
    prev: HashMap<K, ([u64; N], Instant, bool)>,
}

impl<K: Eq + Hash + Clone, const N: usize> Default for Rates<K, N> {
    fn default() -> Self {
        Self {
            prev: HashMap::new(),
        }
    }
}

impl<K: Eq + Hash + Clone, const N: usize> Rates<K, N> {
    /// Record `now`'s counters for `key` and return the per-second rate of each
    /// since the previous reading, or `None` when there is no usable previous one.
    pub(crate) fn observe(
        &mut self,
        key: &K,
        counters: [u64; N],
        now: Instant,
    ) -> Option<[f64; N]> {
        let rates = match self.prev.get(key) {
            Some((prev, at, _)) => per_second(prev, &counters, now.saturating_duration_since(*at)),
            None => None,
        };
        self.prev.insert(key.clone(), (counters, now, true));
        rates
    }

    /// Forget keys not observed since the last call, then start a new round.
    pub(crate) fn retain_seen(&mut self) {
        self.prev.retain(|_, (_, _, seen)| *seen);
        for (_, _, seen) in self.prev.values_mut() {
            *seen = false;
        }
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.prev.len()
    }
}

fn per_second<const N: usize>(
    prev: &[u64; N],
    cur: &[u64; N],
    elapsed: std::time::Duration,
) -> Option<[f64; N]> {
    let secs = elapsed.as_secs_f64();
    if secs <= 0.0 {
        return None;
    }
    let mut out = [0.0; N];
    for (slot, (p, c)) in out.iter_mut().zip(prev.iter().zip(cur)) {
        let delta = c.checked_sub(*p)?;
        // u64 -> f64 loses precision only above 2^53 bytes per interval.
        #[allow(clippy::cast_precision_loss)]
        let delta = delta as f64;
        *slot = delta / secs;
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn first_reading_has_no_rate_and_second_does() {
        let mut r: Rates<&str, 2> = Rates::default();
        let t0 = Instant::now();
        assert_eq!(r.observe(&"eth0", [100, 0], t0), None);
        let rates = r.observe(&"eth0", [300, 50], t0 + Duration::from_secs(2));
        assert_eq!(rates, Some([100.0, 25.0]));
    }

    #[test]
    fn a_counter_going_backwards_is_not_a_rate() {
        let mut r: Rates<&str, 1> = Rates::default();
        let t0 = Instant::now();
        r.observe(&"c", [500], t0);
        assert_eq!(r.observe(&"c", [10], t0 + Duration::from_secs(1)), None);
        // and the reset value becomes the new baseline
        assert_eq!(
            r.observe(&"c", [20], t0 + Duration::from_secs(2)),
            Some([10.0])
        );
    }

    #[test]
    fn unseen_keys_are_forgotten_after_a_round() {
        let mut r: Rates<String, 1> = Rates::default();
        let t0 = Instant::now();
        r.observe(&"a".to_string(), [1], t0);
        r.observe(&"b".to_string(), [1], t0);
        r.retain_seen();
        r.observe(&"a".to_string(), [2], t0 + Duration::from_secs(1));
        r.retain_seen();
        assert_eq!(r.len(), 1);
    }
}
