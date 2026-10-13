//! Host facts: boot id, boot clock, physical identity, mount namespaces and
//! container cgroup state.

use crate::SysError;
use otterd_proto::U53;
use otterd_proto::identity::{HostBinding, HostFacts, ProviderBinding};
use serde::{Deserialize, Serialize};
use std::io::{Read as _, Write as _};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::time::Duration;

/// The kernel's per-boot random id. Changes on every kernel boot, including a
/// hard power cycle.
pub fn kernel_boot_id() -> Result<String, SysError> {
    read_trimmed(Path::new("/proc/sys/kernel/random/boot_id"))
}

fn read_trimmed(path: &Path) -> Result<String, SysError> {
    std::fs::read_to_string(path)
        .map(|s| s.trim().to_owned())
        .map_err(|e| SysError::io("read", path, e))
}

/// `CLOCK_BOOTTIME`: monotonic and counting time spent suspended. Lease
/// durations count from a request's send instant on this clock, so a paused or
/// suspended VM can never gain lease time.
#[cfg(target_os = "linux")]
pub fn boottime() -> Duration {
    let ts = rustix::time::clock_gettime(rustix::time::ClockId::Boottime);
    Duration::new(
        u64::try_from(ts.tv_sec).unwrap_or(0),
        u32::try_from(ts.tv_nsec).unwrap_or(0),
    )
}

#[cfg(not(target_os = "linux"))]
pub fn boottime() -> Duration {
    // Only used off Linux in tests; Instant is monotonic but stops in suspend.
    static START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    START.get_or_init(std::time::Instant::now).elapsed()
}

/// The facts a signed boot manifest and an enrollment bind to. A cloned disk on
/// another machine keeps `/etc/machine-id` but not the DMI product UUID or the
/// provider's server id.
pub fn host_binding(provider: Option<&dyn ProviderIdentity>) -> Result<HostBinding, SysError> {
    Ok(HostBinding {
        machine_id: read_trimmed(Path::new("/etc/machine-id"))?,
        product_uuid: read_trimmed(Path::new("/sys/class/dmi/id/product_uuid")).ok(),
        provider: provider.and_then(|p| match p.server_id() {
            Ok(server_id) => Some(ProviderBinding {
                provider: p.name().to_owned(),
                server_id,
                created_at: None,
            }),
            Err(e) => {
                tracing::warn!(provider = p.name(), error = %e, "provider identity unavailable");
                None
            }
        }),
    })
}

/// Static facts about this host, as the control plane records them at
/// enrollment and once per connection. `docker_version` is left for the
/// caller, which owns the Engine client.
pub fn host_facts() -> Result<HostFacts, SysError> {
    let os_release = std::fs::read_to_string("/etc/os-release").unwrap_or_default();
    let os_field = |key: &str| {
        os_release
            .lines()
            .find_map(|l| l.strip_prefix(key)?.strip_prefix('='))
            .map(|v| v.trim_matches('"').to_owned())
            .unwrap_or_default()
    };
    let memory_kib = std::fs::read_to_string("/proc/meminfo")
        .ok()
        .and_then(|m| {
            m.lines()
                .find_map(|l| l.strip_prefix("MemTotal:"))
                .and_then(|v| v.split_whitespace().next()?.parse::<u64>().ok())
        })
        .unwrap_or(0);
    let systemd_version = std::process::Command::new("systemctl")
        .arg("--version")
        .output()
        .ok()
        .and_then(|o| {
            String::from_utf8_lossy(&o.stdout)
                .split_whitespace()
                .nth(1)
                .map(str::to_owned)
        });
    Ok(HostFacts {
        hostname: read_trimmed(Path::new("/proc/sys/kernel/hostname"))?,
        arch: match std::env::consts::ARCH {
            "x86_64" => "amd64".into(),
            "aarch64" => "arm64".into(),
            other => other.into(),
        },
        os_id: os_field("ID"),
        os_version: os_field("VERSION_ID"),
        kernel: read_trimmed(Path::new("/proc/sys/kernel/osrelease"))?,
        cpu_cores: std::thread::available_parallelism()
            .map_or(1, |n| u32::try_from(n.get()).unwrap_or(u32::MAX)),
        memory_bytes: U53::new(memory_kib.saturating_mul(1024)).unwrap_or(U53::MAX),
        docker_version: None,
        systemd_version,
    })
}

/// A provider's view of which machine this is, read from inside the machine.
pub trait ProviderIdentity: std::fmt::Debug {
    fn name(&self) -> &str;
    fn server_id(&self) -> Result<String, SysError>;
}

/// Hetzner Cloud: the link-local metadata service names the server id.
#[derive(Debug, Clone, Copy, Default)]
pub struct HetznerMetadata;

impl ProviderIdentity for HetznerMetadata {
    fn name(&self) -> &'static str {
        "hetzner"
    }

    fn server_id(&self) -> Result<String, SysError> {
        let body = link_local_get("/hetzner/v1/metadata/instance-id")?;
        let id = body.trim();
        if !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()) {
            Ok(id.to_owned())
        } else {
            Err(SysError::Refused(format!("metadata instance-id {id:?}")))
        }
    }
}

/// `GET http://169.254.169.254<path>`: plain HTTP on the link-local address is
/// what the provider documents. The service may hold the connection open, so
/// the read stops at the declared Content-Length.
fn link_local_get(path: &str) -> Result<String, SysError> {
    let addr: SocketAddr = ([169, 254, 169, 254], 80).into();
    let io = |e| SysError::io("metadata", path, e);
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_secs(2)).map_err(io)?;
    s.set_read_timeout(Some(Duration::from_secs(3)))
        .map_err(io)?;
    write!(
        s,
        "GET {path} HTTP/1.0\r\nHost: 169.254.169.254\r\nConnection: close\r\n\r\n"
    )
    .map_err(io)?;
    let mut raw = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        match s.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                raw.extend_from_slice(chunk.get(..n).unwrap_or_default());
                if raw.len() > 64 * 1024 || body_complete(&raw) {
                    break;
                }
            }
            Err(e)
                if !raw.is_empty()
                    && matches!(
                        e.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
            {
                break;
            }
            Err(e) => return Err(io(e)),
        }
    }
    parse_http_body(&String::from_utf8_lossy(&raw))
}

fn parse_http_body(text: &str) -> Result<String, SysError> {
    let (head, body) = text
        .split_once("\r\n\r\n")
        .ok_or_else(|| SysError::Refused("malformed metadata response".into()))?;
    if head.starts_with("HTTP/1.1 200") || head.starts_with("HTTP/1.0 200") {
        Ok(body.to_owned())
    } else {
        Err(SysError::Refused(format!(
            "metadata status: {}",
            head.lines().next().unwrap_or_default()
        )))
    }
}

fn body_complete(raw: &[u8]) -> bool {
    let text = String::from_utf8_lossy(raw);
    let Some((head, body)) = text.split_once("\r\n\r\n") else {
        return false;
    };
    head.lines()
        .find_map(|l| {
            l.to_ascii_lowercase()
                .strip_prefix("content-length:")
                .and_then(|v| v.trim().parse::<usize>().ok())
        })
        .is_some_and(|len| body.len() >= len)
}

/// Whether process `pid` shares this process's mount namespace. A dockerd in
/// a different (for example slave) namespace would not see a staged mount and
/// would bind the empty staging directory instead, so staging refuses to run.
#[cfg(target_os = "linux")]
pub fn shares_mount_namespace(pid: u32) -> Result<bool, SysError> {
    let ours = std::fs::read_link("/proc/self/ns/mnt")
        .map_err(|e| SysError::io("readlink", "/proc/self/ns/mnt", e))?;
    let path = format!("/proc/{pid}/ns/mnt");
    let theirs = std::fs::read_link(&path).map_err(|e| SysError::io("readlink", &path, e))?;
    Ok(ours == theirs)
}

#[cfg(not(target_os = "linux"))]
pub fn shares_mount_namespace(_pid: u32) -> Result<bool, SysError> {
    Err(SysError::Unsupported)
}

/// The dockerd pid from its pid file.
pub fn dockerd_pid(pid_file: &Path) -> Result<u32, SysError> {
    read_trimmed(pid_file)?
        .parse()
        .map_err(|_| SysError::Refused(format!("{} does not hold a pid", pid_file.display())))
}

/// What the kernel says about a container's cgroup (cgroup v2; systemd or
/// cgroupfs driver).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "cgroup", rename_all = "kebab-case")]
pub enum CgroupObservation {
    /// No cgroup directory exists for this container.
    Absent,
    /// The cgroup exists and has no processes in its subtree.
    Empty,
    /// The cgroup subtree has live processes.
    Populated { pids: Vec<u32> },
    /// The cgroup could not be read: never counts as stopped.
    Unreadable { reason: String },
}

impl CgroupObservation {
    #[must_use]
    pub fn is_empty(&self) -> bool {
        matches!(self, Self::Absent | Self::Empty)
    }
}

/// Observe a Docker container's cgroup independently of the Engine API.
#[must_use]
pub fn container_cgroup(container_id: &str) -> CgroupObservation {
    container_cgroup_in(Path::new("/sys/fs/cgroup"), container_id)
}

#[must_use]
pub fn container_cgroup_in(root: &Path, container_id: &str) -> CgroupObservation {
    if container_id.is_empty() || !container_id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return CgroupObservation::Unreadable {
            reason: format!("{container_id:?} is not a container id"),
        };
    }
    let candidates = [
        root.join("system.slice")
            .join(format!("docker-{container_id}.scope")),
        root.join("docker").join(container_id),
    ];
    let Some(dir) = candidates.iter().find(|p| p.is_dir()) else {
        return CgroupObservation::Absent;
    };
    // `cgroup.events` reports "populated 0|1" for the whole subtree; prefer it.
    match std::fs::read_to_string(dir.join("cgroup.events")) {
        Ok(events) if events.lines().any(|l| l.trim() == "populated 0") => {
            return CgroupObservation::Empty;
        }
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return CgroupObservation::Absent,
        Err(e) => {
            return CgroupObservation::Unreadable {
                reason: e.to_string(),
            };
        }
    }
    match std::fs::read_to_string(dir.join("cgroup.procs")) {
        // Reached only when `cgroup.events` did not say "populated 0": an empty
        // pid list then means a child cgroup holds processes, still populated.
        Ok(text) => CgroupObservation::Populated {
            pids: text.lines().filter_map(|l| l.trim().parse().ok()).collect(),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => CgroupObservation::Absent,
        Err(e) => CgroupObservation::Unreadable {
            reason: e.to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cgroup_observation_reads_events_and_procs() {
        let root = tempfile::tempdir().unwrap();
        let id = "abc123";
        assert_eq!(
            container_cgroup_in(root.path(), id),
            CgroupObservation::Absent
        );
        let dir = root
            .path()
            .join("system.slice")
            .join(format!("docker-{id}.scope"));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("cgroup.events"), "populated 0\nfrozen 0\n").unwrap();
        assert_eq!(
            container_cgroup_in(root.path(), id),
            CgroupObservation::Empty
        );
        std::fs::write(dir.join("cgroup.events"), "populated 1\nfrozen 0\n").unwrap();
        std::fs::write(dir.join("cgroup.procs"), "42\n43\n").unwrap();
        assert_eq!(
            container_cgroup_in(root.path(), id),
            CgroupObservation::Populated { pids: vec![42, 43] }
        );
        // A child cgroup holding the processes: still populated, never "empty".
        std::fs::write(dir.join("cgroup.procs"), "").unwrap();
        assert!(!container_cgroup_in(root.path(), id).is_empty());
        // Path tricks are refused, not resolved.
        assert!(matches!(
            container_cgroup_in(root.path(), "../etc"),
            CgroupObservation::Unreadable { .. }
        ));
    }

    #[test]
    fn metadata_responses() {
        assert_eq!(
            parse_http_body("HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\n123").unwrap(),
            "123"
        );
        assert!(parse_http_body("HTTP/1.1 404 Not Found\r\n\r\n").is_err());
        assert!(body_complete(
            b"HTTP/1.0 200 OK\r\nContent-Length: 3\r\n\r\n123"
        ));
        assert!(!body_complete(
            b"HTTP/1.0 200 OK\r\nContent-Length: 3\r\n\r\n12"
        ));
    }

    #[test]
    fn boottime_is_monotonic() {
        let a = boottime();
        let b = boottime();
        assert!(b >= a);
    }
}
