//! Minimal `sd_notify(3)`: `READY=1`, `STATUS=…`, `WATCHDOG=1`, `STOPPING=1`
//! over `$NOTIFY_SOCKET`.

use std::os::unix::net::UnixDatagram;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct Notifier {
    socket: Option<String>,
}

impl Notifier {
    /// Reads `$NOTIFY_SOCKET`; a no-op notifier when not run under systemd.
    #[must_use]
    pub fn from_env() -> Self {
        Self {
            socket: std::env::var("NOTIFY_SOCKET")
                .ok()
                .filter(|s| !s.is_empty()),
        }
    }

    #[must_use]
    pub fn is_active(&self) -> bool {
        self.socket.is_some()
    }

    /// `$WATCHDOG_USEC` as a duration, when systemd enabled the watchdog for
    /// this process.
    #[must_use]
    pub fn watchdog_interval() -> Option<Duration> {
        let usec: u64 = std::env::var("WATCHDOG_USEC").ok()?.parse().ok()?;
        let for_us = std::env::var("WATCHDOG_PID")
            .ok()
            .and_then(|p| p.parse::<u32>().ok())
            .is_none_or(|p| p == std::process::id());
        (for_us && usec > 0).then(|| Duration::from_micros(usec))
    }

    pub fn ready(&self) -> std::io::Result<()> {
        self.send("READY=1")
    }

    pub fn watchdog(&self) -> std::io::Result<()> {
        self.send("WATCHDOG=1")
    }

    pub fn stopping(&self) -> std::io::Result<()> {
        self.send("STOPPING=1")
    }

    pub fn status(&self, status: &str) -> std::io::Result<()> {
        self.send(&format!("STATUS={}", status.replace('\n', " ")))
    }

    fn send(&self, msg: &str) -> std::io::Result<()> {
        let Some(path) = &self.socket else {
            return Ok(());
        };
        let sock = UnixDatagram::unbound()?;
        #[cfg(target_os = "linux")]
        if let Some(name) = path.strip_prefix('@') {
            use std::os::linux::net::SocketAddrExt as _;
            let addr = std::os::unix::net::SocketAddr::from_abstract_name(name.as_bytes())?;
            sock.send_to_addr(msg.as_bytes(), &addr)?;
            return Ok(());
        }
        sock.send_to(msg.as_bytes(), path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sends_datagrams_to_the_notify_socket() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notify.sock");
        let listener = UnixDatagram::bind(&path).unwrap();
        let n = Notifier {
            socket: Some(path.display().to_string()),
        };
        n.status("reconciling\nslot db#0").unwrap();
        n.watchdog().unwrap();
        let mut buf = [0u8; 128];
        let len = listener.recv(&mut buf).unwrap();
        assert_eq!(&buf[..len], b"STATUS=reconciling slot db#0");
        let len = listener.recv(&mut buf).unwrap();
        assert_eq!(&buf[..len], b"WATCHDOG=1");
        assert!(Notifier { socket: None }.ready().is_ok());
    }
}
