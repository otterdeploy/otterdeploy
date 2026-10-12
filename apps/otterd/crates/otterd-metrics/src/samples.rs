//! Turning one round's readings into `otterd_proto` metric samples.
//!
//! Each sample is one subject and dimension: the host (`host`), one bounded
//! dimension (`fs:<mount>`, `disk:<device>`, `net:<interface>`), or one
//! container (`container`, under the container's own subject). Every sample
//! of a round shares the round's sequence number; the dimension set and
//! subject keep their identities apart.

use crate::reading::{ContainerHealth, ContainerSample, DimensionSample, HostSample};
use otterd_proto::ids::{AttemptId, BootId, InstallId, NodeId, OrgId, SubjectId};
use otterd_proto::metrics::{MetricIdentity, MetricName, MetricSample, MetricValue};
use otterd_proto::num::{DurationMs, U53, UnixMs};

/// Metric schema these samples follow.
pub const METRIC_SCHEMA_VERSION: u16 = 1;

/// Who is reporting: fixed for the life of a node boot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SampleContext {
    pub install_id: InstallId,
    /// The node's organisation, when it belongs to one.
    pub org_id: Option<OrgId>,
    pub node_id: NodeId,
    pub node_epoch: U53,
    pub boot_id: BootId,
    /// The subject host and dimension series belong to.
    pub host_subject: SubjectId,
}

/// The control-plane subject a container's series belong to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContainerSubject {
    pub subject_id: SubjectId,
    pub org_id: Option<OrgId>,
    pub generation: Option<U53>,
    pub attempt_id: Option<AttemptId>,
}

/// What the caller can see of a container to decide its subject.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ContainerRef<'a> {
    pub id: &'a str,
    pub name: &'a str,
    /// The `otterdeploy.resource.id` label, when present.
    pub resource_id: Option<&'a str>,
}

/// When a round was taken and what its rates and freshness mean.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RoundTiming {
    pub observed_at: UnixMs,
    pub clock_uncertainty: DurationMs,
    /// The cadence the rates were computed over.
    pub interval: DurationMs,
    /// How long these values stand for the subject.
    pub ttl: DurationMs,
}

/// u64 counts and byte sizes as wire numbers. Exact below 2^53, which every
/// byte count and rate this collector produces is.
#[allow(clippy::cast_precision_loss)]
fn num(v: u64) -> f64 {
    v as f64
}

fn value(name: MetricName, v: Option<f64>) -> MetricValue {
    MetricValue { name, value: v }
}

pub(crate) struct Builder<'a> {
    pub(crate) ctx: &'a SampleContext,
    pub(crate) timing: RoundTiming,
    pub(crate) seq: U53,
}

impl Builder<'_> {
    fn sample(
        &self,
        subject_id: SubjectId,
        org_id: Option<OrgId>,
        generation: Option<U53>,
        attempt_id: Option<AttemptId>,
        dimension_set: String,
        values: Vec<MetricValue>,
    ) -> MetricSample {
        MetricSample {
            identity: MetricIdentity {
                install_id: self.ctx.install_id.clone(),
                org_id,
                subject_id,
                generation,
                attempt_id,
                node_id: self.ctx.node_id.clone(),
                node_epoch: self.ctx.node_epoch,
                boot_id: self.ctx.boot_id.clone(),
                sample_seq: self.seq,
                dimension_set,
                schema_version: METRIC_SCHEMA_VERSION,
            },
            observed_at_unix_ms: self.timing.observed_at,
            clock_uncertainty_ms: self.timing.clock_uncertainty,
            interval_ms: self.timing.interval,
            ttl_ms: self.timing.ttl,
            values,
        }
    }

    fn node_sample(&self, dimension_set: String, values: Vec<MetricValue>) -> MetricSample {
        self.sample(
            self.ctx.host_subject.clone(),
            self.ctx.org_id.clone(),
            None,
            None,
            dimension_set,
            values,
        )
    }

    pub(crate) fn host(&self, h: &HostSample) -> MetricSample {
        use MetricName as M;
        let cpu = h.cpu;
        let pct =
            |f: fn(&crate::reading::CpuBreakdown) -> f32| cpu.as_ref().map(|c| f64::from(f(c)));
        let load = |i: usize| h.load.and_then(|l| l.get(i).copied()).map(f64::from);
        let mem = h.memory;
        let bytes = |f: fn(&crate::reading::Memory) -> u64| mem.as_ref().map(|m| num(f(m)));
        let values = vec![
            value(M::HostCpuUsedPct, pct(|c| c.total)),
            value(M::HostCpuUserPct, pct(|c| c.user)),
            value(M::HostCpuSystemPct, pct(|c| c.system)),
            value(M::HostCpuIowaitPct, pct(|c| c.iowait)),
            value(M::HostCpuStealPct, pct(|c| c.steal)),
            value(M::HostLoad1, load(0)),
            value(M::HostLoad5, load(1)),
            value(M::HostLoad15, load(2)),
            value(M::HostMemUsedBytes, bytes(|m| m.used)),
            value(M::HostMemTotalBytes, bytes(|m| m.total)),
            value(M::HostMemCachedBytes, bytes(|m| m.cached)),
            value(M::HostMemArcBytes, mem.and_then(|m| m.zfs_arc).map(num)),
            value(M::HostSwapUsedBytes, bytes(|m| m.swap_used)),
            value(M::HostSwapTotalBytes, bytes(|m| m.swap_total)),
        ];
        self.node_sample("host".to_string(), values)
    }

    pub(crate) fn dimension(&self, d: &DimensionSample) -> MetricSample {
        use MetricName as M;
        let (set, values) = match d {
            DimensionSample::Filesystem {
                mount_point,
                total_bytes,
                used_bytes,
                ..
            } => (
                format!("fs:{mount_point}"),
                vec![
                    value(M::FsUsedBytes, Some(num(*used_bytes))),
                    value(M::FsTotalBytes, Some(num(*total_bytes))),
                ],
            ),
            DimensionSample::Disk {
                device,
                read_bytes_per_s,
                write_bytes_per_s,
                busy_pct,
            } => (
                format!("disk:{device}"),
                vec![
                    value(M::DiskReadBytesPerSec, *read_bytes_per_s),
                    value(M::DiskWriteBytesPerSec, *write_bytes_per_s),
                    value(M::DiskUtilPct, busy_pct.map(f64::from)),
                ],
            ),
            DimensionSample::Interface {
                name,
                rx_bytes_per_s,
                tx_bytes_per_s,
                ..
            } => (
                format!("net:{name}"),
                vec![
                    value(M::NetRxBytesPerSec, *rx_bytes_per_s),
                    value(M::NetTxBytesPerSec, *tx_bytes_per_s),
                ],
            ),
        };
        self.node_sample(set, values)
    }

    pub(crate) fn container(&self, c: &ContainerSample, subject: ContainerSubject) -> MetricSample {
        use MetricName as M;
        let healthy = c.health.and_then(|h| match h {
            ContainerHealth::Healthy => Some(1.0),
            ContainerHealth::Unhealthy => Some(0.0),
            ContainerHealth::Starting => None,
        });
        let values = vec![
            value(M::ContainerCpuPct, c.cpu_pct.map(f64::from)),
            value(M::ContainerMemBytes, c.memory_bytes.map(num)),
            value(M::ContainerMemLimitBytes, c.memory_limit_bytes.map(num)),
            value(M::ContainerNetRxBytesPerSec, c.net_rx_bytes_per_s),
            value(M::ContainerNetTxBytesPerSec, c.net_tx_bytes_per_s),
            value(M::ContainerHealthy, healthy),
        ];
        self.sample(
            subject.subject_id,
            subject.org_id.or_else(|| self.ctx.org_id.clone()),
            subject.generation,
            subject.attempt_id,
            "container".to_string(),
            values,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reading::{CpuBreakdown, Memory};

    fn ctx() -> SampleContext {
        SampleContext {
            install_id: InstallId::new("install-1").unwrap(),
            org_id: Some(OrgId::new("org-1").unwrap()),
            node_id: NodeId::new("node-1").unwrap(),
            node_epoch: U53::ONE,
            boot_id: BootId::new("517bb090-f7fe-4f02-9ba6-efd1be63561a").unwrap(),
            host_subject: SubjectId::new("node-1").unwrap(),
        }
    }

    fn builder(c: &SampleContext) -> Builder<'_> {
        Builder {
            ctx: c,
            timing: RoundTiming {
                observed_at: U53::from_const(1_791_810_374_922),
                clock_uncertainty: U53::from_const(5),
                interval: U53::from_const(30_000),
                ttl: U53::from_const(90_000),
            },
            seq: U53::from_const(7),
        }
    }

    #[test]
    fn host_sample_carries_identity_and_nulls_for_what_was_not_measured() {
        let c = ctx();
        let s = builder(&c).host(&HostSample {
            cpu: None,
            cpu_count: Some(4),
            load: Some([0.5, 0.25, 0.125]),
            memory: Some(Memory {
                total: 1000,
                used: 600,
                ..Memory::default()
            }),
            uptime_s: Some(1),
        });
        assert_eq!(s.identity.dimension_set, "host");
        assert_eq!(s.identity.sample_seq, U53::from_const(7));
        assert_eq!(s.identity.schema_version, METRIC_SCHEMA_VERSION);
        let get = |n: MetricName| s.values.iter().find(|v| v.name == n).unwrap().value;
        assert_eq!(
            get(MetricName::HostCpuUsedPct),
            None,
            "first round: no rate"
        );
        assert_eq!(get(MetricName::HostLoad5), Some(0.25));
        assert_eq!(get(MetricName::HostMemUsedBytes), Some(600.0));
        assert_eq!(get(MetricName::HostMemArcBytes), None);
        // round-trips through the wire format
        let json = serde_json::to_string(&s).unwrap();
        let back: MetricSample = serde_json::from_str(&json).unwrap();
        assert_eq!(back, s);
    }

    #[test]
    fn cpu_values_follow_the_breakdown() {
        let c = ctx();
        let s = builder(&c).host(&HostSample {
            cpu: Some(CpuBreakdown {
                total: 50.0,
                user: 30.0,
                ..CpuBreakdown::default()
            }),
            ..HostSample::default()
        });
        assert_eq!(s.values[0].value, Some(50.0));
        assert_eq!(s.values[1].value, Some(30.0));
    }

    #[test]
    fn dimension_sets_name_their_kind() {
        let c = ctx();
        let b = builder(&c);
        let fs = b.dimension(&DimensionSample::Filesystem {
            mount_point: "/var".into(),
            fs_type: "ext4".into(),
            total_bytes: 10,
            used_bytes: 4,
            available_bytes: 6,
        });
        assert_eq!(fs.identity.dimension_set, "fs:/var");
        let net = b.dimension(&DimensionSample::Interface {
            name: "eth0".into(),
            rx_bytes_per_s: None,
            tx_bytes_per_s: Some(5.0),
            rx_errors: 0,
            tx_errors: 0,
        });
        assert_eq!(net.identity.dimension_set, "net:eth0");
        assert_eq!(net.values[0].value, None);
    }

    #[test]
    fn container_samples_use_the_containers_subject_and_fall_back_to_the_node_org() {
        let c = ctx();
        let s = builder(&c).container(
            &ContainerSample {
                container_id: "abc".into(),
                name: "web-1".into(),
                resource_id: Some("svc_1".into()),
                health: Some(ContainerHealth::Starting),
                cpu_pct: Some(12.5),
                memory_bytes: Some(1024),
                memory_limit_bytes: None,
                net_rx_bytes_per_s: None,
                net_tx_bytes_per_s: None,
            },
            ContainerSubject {
                subject_id: SubjectId::new("svc_1").unwrap(),
                org_id: None,
                generation: Some(U53::from_const(3)),
                attempt_id: None,
            },
        );
        assert_eq!(s.identity.subject_id.as_str(), "svc_1");
        assert_eq!(s.identity.org_id, c.org_id);
        assert_eq!(s.identity.generation, Some(U53::from_const(3)));
        let healthy = s
            .values
            .iter()
            .find(|v| v.name == MetricName::ContainerHealthy)
            .unwrap();
        assert_eq!(
            healthy.value, None,
            "starting is not yet healthy or unhealthy"
        );
    }
}
