//! What one collection round read, before it becomes wire samples.
//!
//! A value the collector could not measure is `None`, never zero: a rate
//! needs two reads, so the first round after start reports no rates.
//! [`crate::samples`] turns a round into `otterd_proto` metric samples.

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct HostSample {
    pub(crate) cpu: Option<CpuBreakdown>,
    pub(crate) cpu_count: Option<u32>,
    /// 1, 5 and 15 minute load averages.
    pub(crate) load: Option<[f32; 3]>,
    pub(crate) memory: Option<Memory>,
    pub(crate) uptime_s: Option<u64>,
}

/// Share of all CPUs' time over the interval since the previous round, in
/// percent (0–100 of the whole machine, not per core).
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(crate) struct CpuBreakdown {
    pub(crate) total: f32,
    pub(crate) user: f32,
    pub(crate) nice: f32,
    pub(crate) system: f32,
    pub(crate) iowait: f32,
    pub(crate) irq: f32,
    pub(crate) softirq: f32,
    pub(crate) steal: f32,
}

/// Bytes.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Memory {
    pub(crate) total: u64,
    /// `total - available`: what the kernel cannot hand back without swapping.
    pub(crate) used: u64,
    pub(crate) available: u64,
    pub(crate) buffers: u64,
    /// Page cache plus reclaimable slab.
    pub(crate) cached: u64,
    /// ZFS ARC size, when ZFS is loaded. Counted inside `used` by the kernel,
    /// reported separately because most of it is reclaimable.
    pub(crate) zfs_arc: Option<u64>,
    pub(crate) swap_total: u64,
    pub(crate) swap_used: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum DimensionSample {
    Filesystem {
        mount_point: String,
        fs_type: String,
        total_bytes: u64,
        used_bytes: u64,
        available_bytes: u64,
    },
    Disk {
        device: String,
        read_bytes_per_s: Option<f64>,
        write_bytes_per_s: Option<f64>,
        /// Percent of the interval the device had I/O in flight.
        busy_pct: Option<f32>,
    },
    Interface {
        name: String,
        rx_bytes_per_s: Option<f64>,
        tx_bytes_per_s: Option<f64>,
        rx_errors: u64,
        tx_errors: u64,
    },
}

impl DimensionSample {
    /// The dimension's name within its kind.
    #[cfg(test)]
    pub(crate) fn name(&self) -> &str {
        match self {
            Self::Filesystem { mount_point, .. } => mount_point,
            Self::Disk { device, .. } => device,
            Self::Interface { name, .. } => name,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ContainerHealth {
    Starting,
    Healthy,
    Unhealthy,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ContainerSample {
    pub(crate) container_id: String,
    pub(crate) name: String,
    /// The `otterdeploy.resource.id` label, for containers the product runs.
    pub(crate) resource_id: Option<String>,
    pub(crate) health: Option<ContainerHealth>,
    /// Percent of one CPU (200 = two full cores), like `docker stats`.
    pub(crate) cpu_pct: Option<f32>,
    /// Usage minus inactive file cache, like `docker stats`.
    pub(crate) memory_bytes: Option<u64>,
    pub(crate) memory_limit_bytes: Option<u64>,
    pub(crate) net_rx_bytes_per_s: Option<f64>,
    pub(crate) net_tx_bytes_per_s: Option<f64>,
}
