//! A container's own figures from its cgroup v2 directory.

use crate::paths::HostPaths;
use std::path::{Path, PathBuf};

/// Where Docker puts a container's cgroup: the systemd cgroup driver (the
/// default on systemd hosts) and the cgroupfs driver.
pub(crate) fn locate(paths: &HostPaths, id: &str) -> Option<PathBuf> {
    [
        paths.sys(format!("fs/cgroup/system.slice/docker-{id}.scope")),
        paths.sys(format!("fs/cgroup/docker/{id}")),
    ]
    .into_iter()
    .find(|p| p.join("cpu.stat").exists())
}

/// Counters and gauges read in one round.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct CgroupReading {
    /// Cumulative CPU time, microseconds.
    pub(crate) cpu_usage_usec: Option<u64>,
    /// `memory.current` minus `inactive_file`, as `docker stats` reports it.
    pub(crate) memory_bytes: Option<u64>,
    /// `memory.max`; `None` when unlimited.
    pub(crate) memory_limit_bytes: Option<u64>,
    /// One process in the container, to find its network namespace.
    pub(crate) pid: Option<u32>,
}

pub(crate) fn read(dir: &Path) -> CgroupReading {
    let file = |name: &str| std::fs::read_to_string(dir.join(name)).ok();
    let current = file("memory.current").and_then(|t| t.trim().parse::<u64>().ok());
    let inactive = file("memory.stat").and_then(|t| field(&t, "inactive_file"));
    CgroupReading {
        cpu_usage_usec: file("cpu.stat").and_then(|t| field(&t, "usage_usec")),
        memory_bytes: current.map(|c| c.saturating_sub(inactive.unwrap_or(0))),
        memory_limit_bytes: file("memory.max").and_then(|t| t.trim().parse().ok()),
        pid: file("cgroup.procs").and_then(|t| t.lines().next()?.trim().parse().ok()),
    }
}

/// A `key value` row of a flat-keyed cgroup file.
fn field(text: &str, key: &str) -> Option<u64> {
    text.lines().find_map(|line| {
        let (k, v) = line.split_once(' ')?;
        (k == key).then(|| v.trim().parse().ok()).flatten()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_systemd_driver_cgroup() {
        let root = tempfile::tempdir().unwrap();
        let dir = root
            .path()
            .join("sys/fs/cgroup/system.slice/docker-abc.scope");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("cpu.stat"),
            "usage_usec 5000000\nuser_usec 4000000\n",
        )
        .unwrap();
        std::fs::write(dir.join("memory.current"), "10485760\n").unwrap();
        std::fs::write(dir.join("memory.stat"), "anon 1\ninactive_file 2097152\n").unwrap();
        std::fs::write(dir.join("memory.max"), "max\n").unwrap();
        std::fs::write(dir.join("cgroup.procs"), "4242\n4243\n").unwrap();
        let paths = HostPaths::new(root.path().join("proc"), root.path().join("sys"));
        let found = locate(&paths, "abc").unwrap();
        assert_eq!(
            read(&found),
            CgroupReading {
                cpu_usage_usec: Some(5_000_000),
                memory_bytes: Some(8 * 1024 * 1024),
                memory_limit_bytes: None,
                pid: Some(4242),
            }
        );
        assert_eq!(locate(&paths, "nope"), None);
    }
}
