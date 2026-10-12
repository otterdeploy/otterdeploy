//! The host and its bounded dimensions: CPU, load, memory, filesystems, disk
//! I/O and network interfaces.
//!
//! Everything here reads memory-backed kernel files (`/proc`, `/sys`) and
//! calls `statvfs` only on local block filesystems, so a round does not block
//! on I/O and runs inline on the collector's task.

mod cpu;
mod disk;
mod fs;
mod memory;
mod net;

use crate::bound::round_robin;
use crate::paths::HostPaths;
use crate::rate::Rates;
use crate::reading::{DimensionSample, HostSample};
use otterd_proto::metrics::MAX_NODE_DIMENSIONS as MAX_DIMENSIONS;
use std::path::Path;
use std::time::Instant;

pub(crate) use net::namespace_totals;

/// Previous counters for the host's rates.
#[derive(Debug, Default)]
pub struct HostCollector {
    paths: HostPaths,
    prev_cpu: Option<cpu::CpuTimes>,
    disks: Rates<String, 3>,
    interfaces: Rates<String, 2>,
}

/// Host values plus the bounded dimension rows of one round.
#[derive(Debug)]
pub(crate) struct HostRound {
    pub(crate) host: HostSample,
    pub(crate) dimensions: Vec<DimensionSample>,
    pub(crate) dropped: u32,
}

fn read(path: &Path) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

impl HostCollector {
    pub fn new(paths: HostPaths) -> Self {
        Self {
            paths,
            ..Self::default()
        }
    }

    pub(crate) fn collect(&mut self, now: Instant) -> HostRound {
        let host = self.host_values();
        let mounts = read(&self.paths.proc("self/mountinfo"))
            .map(|t| fs::parse_mountinfo(&t))
            .unwrap_or_default();
        let sys_block = self.paths.sys("block");
        let mut disks: Vec<disk::DiskCounters> = read(&self.paths.proc("diskstats"))
            .map(|t| disk::parse_diskstats(&t))
            .unwrap_or_default()
            .into_iter()
            .filter(|d| disk::is_whole_disk(&sys_block, &d.device))
            .collect();
        disks.sort_by(|a, b| a.device.cmp(&b.device));
        let mut interfaces: Vec<net::InterfaceCounters> = read(&self.paths.proc("net/dev"))
            .map(|t| net::parse_net_dev(&t))
            .unwrap_or_default()
            .into_iter()
            .filter(|i| net::is_host_interface(&i.name))
            .collect();
        interfaces.sort_by(|a, b| a.name.cmp(&b.name));

        // Bound by name first, so rates and statvfs are only spent on what is kept.
        let (chosen, dropped) = round_robin(
            [
                mounts.into_iter().map(Dim::Fs).collect(),
                disks.into_iter().map(Dim::Disk).collect(),
                interfaces.into_iter().map(Dim::Net).collect(),
            ],
            MAX_DIMENSIONS,
        );
        let mut dimensions = Vec::with_capacity(MAX_DIMENSIONS);
        for dim in chosen.into_iter().flatten() {
            if let Some(sample) = self.dimension(dim, now) {
                dimensions.push(sample);
            }
        }
        self.disks.retain_seen();
        self.interfaces.retain_seen();
        HostRound {
            host,
            dimensions,
            dropped: u32::try_from(dropped).unwrap_or(u32::MAX),
        }
    }

    fn host_values(&mut self) -> HostSample {
        let stat = read(&self.paths.proc("stat")).and_then(|t| cpu::parse_stat(&t));
        let (cpu, cpu_count) = match stat {
            Some((times, count)) => {
                let breakdown = self.prev_cpu.and_then(|prev| cpu::breakdown(&prev, &times));
                self.prev_cpu = Some(times);
                (breakdown, Some(count))
            }
            None => (None, None),
        };
        let arc = read(&self.paths.proc("spl/kstat/zfs/arcstats"))
            .and_then(|t| memory::parse_arc_size(&t));
        HostSample {
            cpu,
            cpu_count,
            load: read(&self.paths.proc("loadavg")).and_then(|t| memory::parse_loadavg(&t)),
            memory: read(&self.paths.proc("meminfo")).and_then(|t| memory::parse_meminfo(&t, arc)),
            uptime_s: read(&self.paths.proc("uptime")).and_then(|t| memory::parse_uptime(&t)),
        }
    }

    fn dimension(&mut self, dim: Dim, now: Instant) -> Option<DimensionSample> {
        Some(match dim {
            Dim::Fs(m) => {
                let (total_bytes, used_bytes, available_bytes) = fs::usage(Path::new(&m.point))?;
                DimensionSample::Filesystem {
                    mount_point: m.point,
                    fs_type: m.fs_type,
                    total_bytes,
                    used_bytes,
                    available_bytes,
                }
            }
            Dim::Disk(d) => {
                let rates =
                    self.disks
                        .observe(&d.device, [d.read_bytes, d.written_bytes, d.io_ms], now);
                DimensionSample::Disk {
                    device: d.device,
                    read_bytes_per_s: rates.map(|r| r[0]),
                    write_bytes_per_s: rates.map(|r| r[1]),
                    // io_ms per second / 1000 ms * 100 %
                    #[allow(clippy::cast_possible_truncation)]
                    busy_pct: rates.map(|r| (r[2] / 10.0).clamp(0.0, 100.0) as f32),
                }
            }
            Dim::Net(i) => {
                let rates = self
                    .interfaces
                    .observe(&i.name, [i.rx_bytes, i.tx_bytes], now);
                DimensionSample::Interface {
                    name: i.name,
                    rx_bytes_per_s: rates.map(|r| r[0]),
                    tx_bytes_per_s: rates.map(|r| r[1]),
                    rx_errors: i.rx_errors,
                    tx_errors: i.tx_errors,
                }
            }
        })
    }
}

#[derive(Debug)]
enum Dim {
    Fs(fs::Mount),
    Disk(disk::DiskCounters),
    Net(net::InterfaceCounters),
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn fixture() -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        let p = root.path();
        let w = |rel: &str, text: &str| {
            let path = p.join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        };
        w(
            "proc/stat",
            "cpu  100 0 50 800 10 0 5 35\ncpu0 100 0 50 800 10 0 5 35\n",
        );
        w("proc/loadavg", "0.10 0.20 0.30 1/100 42\n");
        w("proc/uptime", "100.5 90.0\n");
        w(
            "proc/meminfo",
            "MemTotal: 1000 kB\nMemAvailable: 400 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n",
        );
        let tmp = std::env::temp_dir();
        w(
            "proc/self/mountinfo",
            &format!("1 0 8:1 / {} rw - ext4 /dev/sda1 rw\n", tmp.display()),
        );
        w(
            "proc/diskstats",
            "8 0 sda 1 0 10 0 1 0 20 0 0 5 5\n8 1 sda1 1 0 10 0 1 0 20 0 0 5 5\n",
        );
        w(
            "proc/net/dev",
            "h\nh\n eth0: 100 1 0 0 0 0 0 0 200 2 0 0 0 0 0 0\n lo: 1 1 0 0 0 0 0 0 1 1 0 0 0 0 0 0\n",
        );
        std::fs::create_dir_all(p.join("sys/block/sda/device")).unwrap();
        root
    }

    #[test]
    fn first_round_has_values_but_no_rates() {
        let root = fixture();
        let mut c = HostCollector::new(HostPaths::new(
            root.path().join("proc"),
            root.path().join("sys"),
        ));
        let r = c.collect(Instant::now());
        assert_eq!(r.host.cpu, None, "a rate needs two readings");
        assert_eq!(r.host.cpu_count, Some(1));
        assert_eq!(r.host.memory.unwrap().used, 600 * 1024);
        let names: Vec<&str> = r.dimensions.iter().map(DimensionSample::name).collect();
        assert_eq!(names.len(), 3, "{names:?}");
        assert!(names.contains(&"sda") && names.contains(&"eth0"));
        for d in &r.dimensions {
            if let DimensionSample::Interface { rx_bytes_per_s, .. } = d {
                assert_eq!(*rx_bytes_per_s, None);
            }
        }
    }

    #[test]
    fn second_round_has_rates() {
        let root = fixture();
        let mut c = HostCollector::new(HostPaths::new(
            root.path().join("proc"),
            root.path().join("sys"),
        ));
        let t0 = Instant::now();
        c.collect(t0);
        std::fs::write(
            root.path().join("proc/stat"),
            "cpu  150 0 50 850 10 0 5 35\ncpu0 150 0 50 850 10 0 5 35\n",
        )
        .unwrap();
        std::fs::write(
            root.path().join("proc/net/dev"),
            "h\nh\n eth0: 1100 1 0 0 0 0 0 0 2200 2 0 0 0 0 0 0\n",
        )
        .unwrap();
        let r = c.collect(t0 + Duration::from_secs(10));
        let cpu = r.host.cpu.unwrap();
        assert!((cpu.total - 50.0).abs() < 1e-3);
        let eth0 = r.dimensions.iter().find(|d| d.name() == "eth0").unwrap();
        assert_eq!(
            eth0,
            &DimensionSample::Interface {
                name: "eth0".into(),
                rx_bytes_per_s: Some(100.0),
                tx_bytes_per_s: Some(200.0),
                rx_errors: 0,
                tx_errors: 0,
            }
        );
    }
}
