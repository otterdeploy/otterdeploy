//! The little of the Docker Engine API the network layer reads: running containers with their
//! PID and per-network MAC/IPv4. Every call is bounded, and nothing here is called unless
//! `docker.service` reports active (calling the daemon mid-restart triggers socket activation
//! and can deadlock the restart behind a reconcile lock).

use std::io::{Read, Write};
use std::net::Ipv4Addr;
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::time::Duration;

use serde::Deserialize;

use crate::cmd::Runner;
use crate::policy::Mac;

/// One container interface on a Docker network.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContainerIface {
    /// Container name (without the leading `/`).
    pub name: String,
    /// Init PID in the host PID namespace.
    pub pid: u32,
    /// Docker network name.
    pub network: String,
    /// Interface MAC.
    pub mac: Mac,
    /// Interface IPv4 address.
    pub ip: Ipv4Addr,
}

/// Reads container interfaces.
pub trait ContainerSource {
    /// Interfaces of running containers.
    ///
    /// # Errors
    /// [`EngineError`] when the daemon is unreachable or answers badly.
    fn interfaces(&self) -> Result<Vec<ContainerIface>, EngineError>;
}

/// An Engine API call that failed.
#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    /// Socket I/O failed or timed out.
    #[error("docker socket: {0}")]
    Io(#[from] std::io::Error),
    /// Non-2xx status.
    #[error("docker API {path}: HTTP {status}")]
    Status {
        /// Path.
        path: String,
        /// Status.
        status: u16,
    },
    /// The response could not be parsed.
    #[error("docker API {path}: {why}")]
    Parse {
        /// Path.
        path: String,
        /// Reason.
        why: String,
    },
}

/// Engine API client over the unix socket, one bounded request per connection.
#[derive(Debug, Clone)]
pub struct Engine {
    socket: PathBuf,
    timeout: Duration,
}

impl Default for Engine {
    fn default() -> Self {
        Self {
            socket: PathBuf::from("/var/run/docker.sock"),
            timeout: Duration::from_secs(5),
        }
    }
}

#[derive(Deserialize)]
struct Summary {
    #[serde(rename = "Id")]
    id: String,
}

#[derive(Deserialize)]
struct Inspect {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "State")]
    state: State,
    #[serde(rename = "NetworkSettings")]
    network_settings: NetworkSettings,
}

#[derive(Deserialize)]
struct State {
    #[serde(rename = "Pid")]
    pid: u32,
}

#[derive(Deserialize)]
struct NetworkSettings {
    #[serde(rename = "Networks", default)]
    networks: std::collections::BTreeMap<String, Endpoint>,
}

#[derive(Deserialize)]
struct Endpoint {
    #[serde(rename = "MacAddress", default)]
    mac: String,
    #[serde(rename = "IPAddress", default)]
    ip: String,
}

impl Engine {
    /// A client for `socket` with a per-request bound.
    #[must_use]
    pub const fn new(socket: PathBuf, timeout: Duration) -> Self {
        Self { socket, timeout }
    }

    fn get(&self, path: &str) -> Result<Vec<u8>, EngineError> {
        let mut s = UnixStream::connect(&self.socket)?;
        s.set_read_timeout(Some(self.timeout))?;
        s.set_write_timeout(Some(self.timeout))?;
        write!(
            s,
            "GET {path} HTTP/1.1\r\nHost: docker\r\nConnection: close\r\n\r\n"
        )?;
        let mut raw = Vec::new();
        s.read_to_end(&mut raw)?;
        decode_http(&raw)
            .map_err(|why| EngineError::Parse {
                path: path.to_owned(),
                why,
            })
            .and_then(|(status, body)| {
                if (200..300).contains(&status) {
                    Ok(body)
                } else {
                    Err(EngineError::Status {
                        path: path.to_owned(),
                        status,
                    })
                }
            })
    }

    fn json<T: for<'de> Deserialize<'de>>(&self, path: &str) -> Result<T, EngineError> {
        let body = self.get(path)?;
        serde_json::from_slice(&body).map_err(|e| EngineError::Parse {
            path: path.to_owned(),
            why: e.to_string(),
        })
    }
}

impl ContainerSource for Engine {
    fn interfaces(&self) -> Result<Vec<ContainerIface>, EngineError> {
        let list: Vec<Summary> = self.json("/containers/json")?;
        let mut out = Vec::new();
        for c in list {
            // A container can exit between list and inspect; skip it rather than fail the pass.
            let i: Inspect = match self.json(&format!("/containers/{}/json", c.id)) {
                Ok(i) => i,
                Err(EngineError::Status { status: 404, .. }) => continue,
                Err(e) => return Err(e),
            };
            if i.state.pid == 0 {
                continue;
            }
            for (network, ep) in i.network_settings.networks {
                let (Ok(mac), Ok(ip)) = (ep.mac.parse::<Mac>(), ep.ip.parse::<Ipv4Addr>()) else {
                    continue;
                };
                out.push(ContainerIface {
                    name: i.name.trim_start_matches('/').to_owned(),
                    pid: i.state.pid,
                    network,
                    mac,
                    ip,
                });
            }
        }
        Ok(out)
    }
}

/// Splits an HTTP/1.1 response into status and body, undoing chunked encoding.
fn decode_http(raw: &[u8]) -> Result<(u16, Vec<u8>), String> {
    let split = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or("no header terminator")?;
    let (head, body) = raw.split_at(split);
    let head = std::str::from_utf8(head).map_err(|e| e.to_string())?;
    let body = body.get(4..).unwrap_or_default();
    let status: u16 = head
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .ok_or("no status code")?;
    let chunked = head.lines().any(|l| {
        let l = l.to_ascii_lowercase();
        l.starts_with("transfer-encoding:") && l.contains("chunked")
    });
    if !chunked {
        return Ok((status, body.to_vec()));
    }
    let mut out = Vec::new();
    let mut rest = body;
    loop {
        let line_end = rest
            .windows(2)
            .position(|w| w == b"\r\n")
            .ok_or("truncated chunk header")?;
        let (size_line, after) = rest.split_at(line_end);
        let size_text = std::str::from_utf8(size_line).map_err(|e| e.to_string())?;
        let size = usize::from_str_radix(size_text.split(';').next().unwrap_or("").trim(), 16)
            .map_err(|e| e.to_string())?;
        rest = after.get(2..).ok_or("truncated chunk header")?;
        if size == 0 {
            return Ok((status, out));
        }
        let chunk = rest.get(..size).ok_or("truncated chunk")?;
        out.extend_from_slice(chunk);
        rest = rest.get(size + 2..).ok_or("truncated chunk trailer")?;
    }
}

/// Whether `docker.service` is active, asked of systemd (never of the daemon).
#[must_use]
pub fn docker_active<R: Runner>(runner: &R) -> bool {
    runner
        .run(
            "systemctl",
            &["is-active", "--quiet", "docker.service"],
            None,
            Duration::from_secs(5),
        )
        .is_ok_and(|o| o.success())
}

/// systemd's `MainPID` of `docker.service`; a change means the daemon restarted.
#[must_use]
pub fn docker_main_pid<R: Runner>(runner: &R) -> Option<u32> {
    let out = runner
        .run(
            "systemctl",
            &["show", "-p", "MainPID", "--value", "docker.service"],
            None,
            Duration::from_secs(5),
        )
        .ok()?;
    out.stdout.trim().parse().ok().filter(|p| *p != 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_plain_and_chunked_bodies() {
        let plain = b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n[]";
        assert_eq!(decode_http(plain).unwrap(), (200, b"[]".to_vec()));
        let chunked =
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\n[{}\r\n1\r\n]\r\n0\r\n\r\n";
        assert_eq!(decode_http(chunked).unwrap(), (200, b"[{}]".to_vec()));
        assert_eq!(
            decode_http(b"HTTP/1.1 404 Not Found\r\n\r\n").unwrap().0,
            404
        );
        assert!(decode_http(b"garbage").is_err());
    }

    #[test]
    fn inspect_shape_parses() {
        let text = r#"{"Name":"/web","State":{"Pid":42},"NetworkSettings":{"Networks":{"otb-a":{"MacAddress":"02:42:ac:18:00:02","IPAddress":"172.24.0.2"},"none":{"MacAddress":"","IPAddress":""}}}}"#;
        let i: Inspect = serde_json::from_str(text).unwrap();
        assert_eq!(
            (
                i.name.as_str(),
                i.state.pid,
                i.network_settings.networks.len()
            ),
            ("/web", 42, 2)
        );
    }
}
