//! `/proc/stat`: aggregate CPU time and the CPU count.

use crate::reading::CpuBreakdown;

/// Cumulative jiffies of the aggregate `cpu` line, in `/proc/stat` order.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct CpuTimes {
    pub(crate) user: u64,
    pub(crate) nice: u64,
    pub(crate) system: u64,
    pub(crate) idle: u64,
    pub(crate) iowait: u64,
    pub(crate) irq: u64,
    pub(crate) softirq: u64,
    pub(crate) steal: u64,
}

impl CpuTimes {
    /// Guest time is already included in user/nice, so it is not added again.
    fn total(&self) -> u64 {
        self.user
            .saturating_add(self.nice)
            .saturating_add(self.system)
            .saturating_add(self.idle)
            .saturating_add(self.iowait)
            .saturating_add(self.irq)
            .saturating_add(self.softirq)
            .saturating_add(self.steal)
    }
}

/// The aggregate line and the number of `cpuN` lines.
pub(crate) fn parse_stat(text: &str) -> Option<(CpuTimes, u32)> {
    let mut times = None;
    let mut count = 0u32;
    for line in text.lines() {
        let mut fields = line.split_ascii_whitespace();
        match fields.next() {
            Some("cpu") => {
                let v: Vec<u64> = fields.take(8).filter_map(|f| f.parse().ok()).collect();
                // Kernels since 2.6.11 print at least these eight fields.
                if let [user, nice, system, idle, iowait, irq, softirq, steal] = v[..] {
                    times = Some(CpuTimes {
                        user,
                        nice,
                        system,
                        idle,
                        iowait,
                        irq,
                        softirq,
                        steal,
                    });
                }
            }
            Some(name) if name.starts_with("cpu") => count = count.saturating_add(1),
            _ => {}
        }
    }
    times.map(|t| (t, count))
}

/// Share of the elapsed jiffies spent in each state, in percent. `None` when
/// no time passed or a counter went backwards.
pub(crate) fn breakdown(prev: &CpuTimes, cur: &CpuTimes) -> Option<CpuBreakdown> {
    let elapsed = cur.total().checked_sub(prev.total())?;
    if elapsed == 0 {
        return None;
    }
    let pct = |a: u64, b: u64| -> Option<f32> {
        let d = a.checked_sub(b)?;
        // Ratios of jiffy counts, 0..=100: f32 precision is ample for a
        // percentage and the value cannot overflow it.
        #[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation)]
        Some((d as f64 / elapsed as f64 * 100.0) as f32)
    };
    let idle = pct(cur.idle, prev.idle)?;
    Some(CpuBreakdown {
        total: (100.0 - idle).clamp(0.0, 100.0),
        user: pct(cur.user, prev.user)?,
        nice: pct(cur.nice, prev.nice)?,
        system: pct(cur.system, prev.system)?,
        iowait: pct(cur.iowait, prev.iowait)?,
        irq: pct(cur.irq, prev.irq)?,
        softirq: pct(cur.softirq, prev.softirq)?,
        steal: pct(cur.steal, prev.steal)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const STAT: &str = "cpu  100 0 50 800 10 0 5 35 0 0\n\
cpu0 50 0 25 400 5 0 2 18 0 0\n\
cpu1 50 0 25 400 5 0 3 17 0 0\n\
intr 12345\nctxt 999\n";

    #[test]
    fn parses_the_aggregate_line_and_counts_cpus() {
        let (t, n) = parse_stat(STAT).unwrap();
        assert_eq!(n, 2);
        assert_eq!(t.user, 100);
        assert_eq!(t.steal, 35);
    }

    #[test]
    fn breakdown_is_share_of_elapsed_time() {
        let prev = CpuTimes {
            idle: 1000,
            ..Default::default()
        };
        let cur = CpuTimes {
            user: 30,
            system: 10,
            iowait: 10,
            idle: 1050,
            ..Default::default()
        };
        let b = breakdown(&prev, &cur).unwrap();
        assert!((b.total - 50.0).abs() < 1e-4);
        assert!((b.user - 30.0).abs() < 1e-4);
        assert!((b.iowait - 10.0).abs() < 1e-4);
    }

    #[test]
    fn no_elapsed_time_is_no_reading() {
        let t = CpuTimes::default();
        assert_eq!(breakdown(&t, &t), None);
    }
}
