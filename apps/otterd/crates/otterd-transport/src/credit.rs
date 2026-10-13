//! Telemetry credit.
//!
//! The control plane grants the node `telemetryCredit` items at `welcome`.
//! Each batch consumes one item per probe result, metric sample, marker and
//! signal, and every `telemetryAck` grants back `credit` items, never beyond
//! the announced window. With no credit the node keeps buffering locally (the
//! collector's own bounded queue); it never sends beyond credit.

use otterd_proto::metrics::SampleBatch;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TelemetryCredit {
    available: u32,
    window: u32,
}

/// Items a batch consumes.
#[must_use]
pub fn batch_items(batch: &SampleBatch) -> u32 {
    let n = batch.probes.len() + batch.metrics.len() + batch.markers.len() + batch.signals.len();
    u32::try_from(n).unwrap_or(u32::MAX)
}

impl TelemetryCredit {
    #[must_use]
    pub fn new(window: u32) -> Self {
        Self {
            available: window,
            window,
        }
    }

    #[must_use]
    pub fn available(&self) -> u32 {
        self.available
    }

    /// Consume `items` if the whole batch fits.
    pub fn try_take(&mut self, items: u32) -> bool {
        if items <= self.available {
            self.available -= items;
            true
        } else {
            false
        }
    }

    /// Credit returned by an acknowledgement, capped at the window.
    pub fn grant(&mut self, items: u32) {
        self.available = self.available.saturating_add(items).min(self.window);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn never_exceeds_the_window() {
        let mut c = TelemetryCredit::new(100);
        assert!(c.try_take(60));
        assert!(!c.try_take(41), "a batch that does not fit is not sent");
        assert!(c.try_take(40));
        assert_eq!(c.available(), 0);
        c.grant(1_000);
        assert_eq!(c.available(), 100, "capped at the window");
    }
}
