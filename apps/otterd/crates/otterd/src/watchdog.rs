//! Progress-tied systemd watchdog.
//!
//! `WatchdogSec=` restarts a hung otterd. Petting on a timer would keep a
//! wedged reconciler alive, so the pet only happens while the reconciler keeps
//! completing passes: no completed pass within the stall budget means no pet,
//! and systemd restarts the daemon, which re-enters boot quarantine. A slow or
//! unreachable Engine does not stall a pass (it completes with errors), so a
//! Docker outage alone never restarts otterd. A watchdog restart is not
//! workload death and never proves anything stopped.

use otterd_sys::host::boottime;
use otterd_sys::notify::Notifier;
use serde::Serialize;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

#[derive(Debug, Clone, Default)]
pub struct Progress {
    inner: Arc<ProgressInner>,
}

#[derive(Debug, Default)]
struct ProgressInner {
    passes: AtomicU64,
    /// `CLOCK_BOOTTIME` milliseconds of the last completed pass.
    last_pass_ms: AtomicU64,
    pets: AtomicU64,
    withheld: AtomicU64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressSnapshot {
    pub passes: u64,
    pub ms_since_last_pass: Option<u64>,
    pub pets: u64,
    pub withheld_pets: u64,
}

fn now_ms() -> u64 {
    u64::try_from(boottime().as_millis()).unwrap_or(u64::MAX)
}

impl Progress {
    /// Record one completed reconcile pass.
    pub fn pass_completed(&self) {
        self.inner.passes.fetch_add(1, Ordering::SeqCst);
        self.inner
            .last_pass_ms
            .store(now_ms().max(1), Ordering::SeqCst);
    }

    #[must_use]
    pub fn snapshot(&self) -> ProgressSnapshot {
        let last = self.inner.last_pass_ms.load(Ordering::SeqCst);
        ProgressSnapshot {
            passes: self.inner.passes.load(Ordering::SeqCst),
            ms_since_last_pass: (last > 0).then(|| now_ms().saturating_sub(last)),
            pets: self.inner.pets.load(Ordering::SeqCst),
            withheld_pets: self.inner.withheld.load(Ordering::SeqCst),
        }
    }

    /// The last pass completed within `budget`.
    #[must_use]
    pub fn fresh_within(&self, budget: Duration) -> bool {
        let last = self.inner.last_pass_ms.load(Ordering::SeqCst);
        last > 0
            && now_ms().saturating_sub(last)
                <= u64::try_from(budget.as_millis()).unwrap_or(u64::MAX)
    }

    /// One watchdog decision: pet if fresh, otherwise withhold.
    pub fn tick(&self, budget: Duration, pet: impl FnOnce() -> std::io::Result<()>) -> bool {
        if self.fresh_within(budget) {
            if let Err(e) = pet() {
                tracing::warn!(error = %e, "watchdog notify failed");
            }
            self.inner.pets.fetch_add(1, Ordering::SeqCst);
            true
        } else {
            self.inner.withheld.fetch_add(1, Ordering::SeqCst);
            tracing::warn!(
                ?budget,
                "reconciler made no progress: withholding the watchdog pet"
            );
            false
        }
    }
}

/// Pet systemd every `interval / 4` while the last completed pass is younger
/// than `interval / 2`. Returns at once when no watchdog is configured.
pub async fn run(progress: Progress, notifier: Notifier) {
    let Some(interval) = Notifier::watchdog_interval() else {
        tracing::info!("systemd watchdog not configured");
        return;
    };
    let budget = interval / 2;
    tracing::info!(?interval, ?budget, "progress-tied watchdog active");
    let mut tick = tokio::time::interval(interval / 4);
    loop {
        tick.tick().await;
        progress.tick(budget, || notifier.watchdog());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pets_only_while_passes_complete() {
        let p = Progress::default();
        assert!(
            !p.tick(Duration::from_secs(5), || Ok(())),
            "no pass yet: no pet"
        );
        p.pass_completed();
        assert!(p.tick(Duration::from_secs(5), || Ok(())));
        let s = p.snapshot();
        assert_eq!(s.passes, 1);
        assert_eq!((s.pets, s.withheld_pets), (1, 1));
    }
}
