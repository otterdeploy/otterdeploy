//! Metric samples, series markers, node signals and telemetry batches
//! (MONITORING §5 `MetricIdentity`, §6, §6.2).
//!
//! Telemetry travels on the authenticated control session, not in per-frame
//! signatures. Each batch says whether it is `live` (just observed) or replay
//! (buffered while disconnected): replay can correct history but never raise a
//! current alert (MONITORING §6.2).

use crate::health::ProbeResult;
use crate::ids::{AttemptId, BatchId, BootId, InstallId, NodeId, OrgId, SubjectId};
use crate::num::{DurationMs, U53, UnixMs};
use serde::{Deserialize, Serialize};

/// Source-side bound on non-container metric dimensions per node (the
/// control plane refuses the 17th series; the node must not produce it).
pub const MAX_NODE_DIMENSIONS: usize = 16;
/// Largest batch a node sends in one frame (also bounded by the frame size).
pub const MAX_BATCH_ITEMS: usize = 2_000;

/// The metric vocabulary for the MONITORING §3 subset. Units are in the name.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum MetricName {
    #[serde(rename = "host.cpu.used_pct")]
    HostCpuUsedPct,
    #[serde(rename = "host.cpu.user_pct")]
    HostCpuUserPct,
    #[serde(rename = "host.cpu.system_pct")]
    HostCpuSystemPct,
    #[serde(rename = "host.cpu.iowait_pct")]
    HostCpuIowaitPct,
    #[serde(rename = "host.cpu.steal_pct")]
    HostCpuStealPct,
    #[serde(rename = "host.load.1")]
    HostLoad1,
    #[serde(rename = "host.load.5")]
    HostLoad5,
    #[serde(rename = "host.load.15")]
    HostLoad15,
    #[serde(rename = "host.mem.used_bytes")]
    HostMemUsedBytes,
    #[serde(rename = "host.mem.total_bytes")]
    HostMemTotalBytes,
    #[serde(rename = "host.mem.cached_bytes")]
    HostMemCachedBytes,
    #[serde(rename = "host.mem.arc_bytes")]
    HostMemArcBytes,
    #[serde(rename = "host.swap.used_bytes")]
    HostSwapUsedBytes,
    #[serde(rename = "host.swap.total_bytes")]
    HostSwapTotalBytes,
    /// Dimension: mount point.
    #[serde(rename = "fs.used_bytes")]
    FsUsedBytes,
    #[serde(rename = "fs.total_bytes")]
    FsTotalBytes,
    /// Dimension: block device.
    #[serde(rename = "disk.read_bytes_per_sec")]
    DiskReadBytesPerSec,
    #[serde(rename = "disk.write_bytes_per_sec")]
    DiskWriteBytesPerSec,
    #[serde(rename = "disk.util_pct")]
    DiskUtilPct,
    /// Dimension: interface.
    #[serde(rename = "net.rx_bytes_per_sec")]
    NetRxBytesPerSec,
    #[serde(rename = "net.tx_bytes_per_sec")]
    NetTxBytesPerSec,
    #[serde(rename = "container.cpu_pct")]
    ContainerCpuPct,
    #[serde(rename = "container.mem_bytes")]
    ContainerMemBytes,
    #[serde(rename = "container.mem_limit_bytes")]
    ContainerMemLimitBytes,
    #[serde(rename = "container.net.rx_bytes_per_sec")]
    ContainerNetRxBytesPerSec,
    #[serde(rename = "container.net.tx_bytes_per_sec")]
    ContainerNetTxBytesPerSec,
    /// 1 healthy, 0 unhealthy, null unknown.
    #[serde(rename = "container.healthy")]
    ContainerHealthy,
    /// Dimension: unit name. 1 active, 0 failed/inactive.
    #[serde(rename = "systemd.unit_active")]
    SystemdUnitActive,
    /// Dimension: pool. 1 online, 0 degraded/faulted.
    #[serde(rename = "zfs.pool_online")]
    ZfsPoolOnline,
    #[serde(rename = "zfs.pool_used_bytes")]
    ZfsPoolUsedBytes,
}

impl MetricName {
    pub const ALL: [Self; 30] = [
        Self::HostCpuUsedPct,
        Self::HostCpuUserPct,
        Self::HostCpuSystemPct,
        Self::HostCpuIowaitPct,
        Self::HostCpuStealPct,
        Self::HostLoad1,
        Self::HostLoad5,
        Self::HostLoad15,
        Self::HostMemUsedBytes,
        Self::HostMemTotalBytes,
        Self::HostMemCachedBytes,
        Self::HostMemArcBytes,
        Self::HostSwapUsedBytes,
        Self::HostSwapTotalBytes,
        Self::FsUsedBytes,
        Self::FsTotalBytes,
        Self::DiskReadBytesPerSec,
        Self::DiskWriteBytesPerSec,
        Self::DiskUtilPct,
        Self::NetRxBytesPerSec,
        Self::NetTxBytesPerSec,
        Self::ContainerCpuPct,
        Self::ContainerMemBytes,
        Self::ContainerMemLimitBytes,
        Self::ContainerNetRxBytesPerSec,
        Self::ContainerNetTxBytesPerSec,
        Self::ContainerHealthy,
        Self::SystemdUnitActive,
        Self::ZfsPoolOnline,
        Self::ZfsPoolUsedBytes,
    ];
}

/// Identity of one metric observation (MONITORING §5 `MetricIdentity`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricIdentity {
    pub install_id: InstallId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub org_id: Option<OrgId>,
    pub subject_id: SubjectId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generation: Option<U53>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<AttemptId>,
    pub node_id: NodeId,
    pub node_epoch: U53,
    pub boot_id: BootId,
    pub sample_seq: U53,
    /// Bounded dimension label (`host`, `fs:/var`, `net:eth0`); never a URL,
    /// message or container label.
    pub dimension_set: String,
    pub schema_version: u16,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricValue {
    pub name: MetricName,
    /// `null` = not measured this round (a wrong number is worse than a missing
    /// one: counter rollbacks and ceiling breaches are sent as null).
    pub value: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricSample {
    pub identity: MetricIdentity,
    pub observed_at_unix_ms: UnixMs,
    pub clock_uncertainty_ms: DurationMs,
    /// Requesting cadence the rates were computed for.
    pub interval_ms: DurationMs,
    pub ttl_ms: DurationMs,
    pub values: Vec<MetricValue>,
}

/// Markers cut the predecessor in the correction ledger (MONITORING §6.0).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MarkerKind {
    Boot,
    GapStart,
    GapEnd,
    Tombstone,
    MaintenanceStart,
    MaintenanceEnd,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesMarker {
    pub kind: MarkerKind,
    pub at_unix_ms: UnixMs,
    pub seq: U53,
    /// `None` = every series of this node and boot.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject_id: Option<SubjectId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dimension_set: Option<String>,
}

/// In-fleet node signals behind the MONITORING §6.2 built-ins. None is a
/// fencing or failover input.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SignalKind {
    FirewallDrift,
    DockerRulesMissing,
    MeshPeerBlocked,
    VipReceiverStalled,
    DnsResponderDown,
    EngineUnreachable,
    WatchdogRestart,
    BootQuarantine,
    ProbeCapacity,
}

impl SignalKind {
    pub const ALL: [Self; 9] = [
        Self::FirewallDrift,
        Self::DockerRulesMissing,
        Self::MeshPeerBlocked,
        Self::VipReceiverStalled,
        Self::DnsResponderDown,
        Self::EngineUnreachable,
        Self::WatchdogRestart,
        Self::BootQuarantine,
        Self::ProbeCapacity,
    ];
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeSignal {
    pub kind: SignalKind,
    pub active: bool,
    pub since_unix_ms: UnixMs,
    /// Bounded, allowlisted detail code (e.g. `table-deleted`, `peer:<nodeId>`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// Node → CP telemetry frame body.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleBatch {
    pub batch_id: BatchId,
    pub node_id: NodeId,
    pub node_epoch: U53,
    pub boot_id: BootId,
    /// Live observation versus replay from the local buffer.
    pub live: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub probes: Vec<ProbeResult>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub metrics: Vec<MetricSample>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub markers: Vec<SeriesMarker>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub signals: Vec<NodeSignal>,
}

impl SampleBatch {
    #[must_use]
    pub fn len(&self) -> usize {
        self.probes.len() + self.metrics.len() + self.markers.len() + self.signals.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// Why the CP did not accept (part of) a batch. Replay is shed under pressure;
/// live data is never shed silently.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BatchDisposition {
    Accepted,
    /// Retry later (replay lane busy or disk pressure); keep buffering.
    Deferred,
    /// Refused permanently (quota, contradiction); drop and count.
    Refused,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_finite_values_travel_as_null() {
        let v = MetricValue {
            name: MetricName::HostLoad1,
            value: Some(f64::NAN),
        };
        let json = serde_json::to_string(&v).unwrap();
        assert_eq!(json, r#"{"name":"host.load.1","value":null}"#);
        let back: MetricValue = serde_json::from_str(&json).unwrap();
        assert_eq!(back.value, None);
    }
}
