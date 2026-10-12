//! One collection round across the host and its containers.

use crate::container::ContainerCollector;
use crate::host::HostCollector;
use crate::paths::HostPaths;
use crate::samples::{Builder, ContainerRef, ContainerSubject, RoundTiming, SampleContext};
use otterd_proto::metrics::MetricSample;
use otterd_proto::num::U53;
use std::time::Instant;

/// The kernel's per-boot id. A new boot is a new metric source.
///
/// # Errors
/// The file is unreadable (not Linux, or `/proc` is not mounted).
pub fn kernel_boot_id(paths: &HostPaths) -> std::io::Result<String> {
    std::fs::read_to_string(paths.proc("sys/kernel/random/boot_id")).map(|s| s.trim().to_string())
}

/// The samples of one round and what was left out of it.
#[derive(Debug, Clone, PartialEq)]
pub struct Round {
    pub samples: Vec<MetricSample>,
    /// Dimensions found but not reported because of the per-node bound.
    pub dimensions_dropped: u32,
    /// Running containers with no control-plane subject (not reported).
    pub containers_unmapped: u32,
    /// Why container metrics are absent this round, when they are.
    pub containers_unavailable: Option<String>,
}

#[derive(Debug)]
pub struct Collector {
    next_seq: U53,
    host: HostCollector,
    containers: Option<ContainerCollector>,
}

impl Collector {
    /// `next_seq` is the first sequence number to use. The caller persists
    /// [`Collector::next_seq`] so a restart within the same boot never
    /// reuses a number.
    pub fn new(next_seq: U53, host: HostCollector, containers: Option<ContainerCollector>) -> Self {
        Self {
            next_seq,
            host,
            containers,
        }
    }

    pub fn next_seq(&self) -> U53 {
        self.next_seq
    }

    /// Collect one round. Never fails: what could not be read is `null` in
    /// its sample and, for containers, the reason is in the round.
    /// `subject_of` maps a running container to the subject its series
    /// belong to; containers it does not know are left out and counted.
    pub async fn collect(
        &mut self,
        ctx: &SampleContext,
        timing: RoundTiming,
        subject_of: impl Fn(&ContainerRef<'_>) -> Option<ContainerSubject>,
    ) -> Round {
        let now = Instant::now();
        let host = self.host.collect(now);
        let builder = Builder {
            ctx,
            timing,
            seq: self.next_seq,
        };
        // Sequence numbers stop at U53::MAX rather than wrap; a node never
        // gets near 2^53 rounds within one boot.
        self.next_seq = self.next_seq.saturating_add(1);
        let mut samples = Vec::with_capacity(1 + host.dimensions.len());
        samples.push(builder.host(&host.host));
        samples.extend(host.dimensions.iter().map(|d| builder.dimension(d)));
        let mut containers_unmapped = 0u32;
        let containers_unavailable = match self.containers.as_mut() {
            None => Some("container runtime not configured".to_string()),
            Some(c) => match c.collect(now).await {
                Ok(list) => {
                    for sample in &list {
                        let reference = ContainerRef {
                            id: &sample.container_id,
                            name: &sample.name,
                            resource_id: sample.resource_id.as_deref(),
                        };
                        match subject_of(&reference) {
                            Some(subject) => samples.push(builder.container(sample, subject)),
                            None => containers_unmapped = containers_unmapped.saturating_add(1),
                        }
                    }
                    None
                }
                Err(e) => {
                    tracing::warn!(error = %e, "container metrics unavailable this round");
                    Some(e.to_string())
                }
            },
        };
        Round {
            samples,
            dimensions_dropped: host.dropped,
            containers_unmapped,
            containers_unavailable,
        }
    }
}
