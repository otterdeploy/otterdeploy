//! Per-container CPU, memory, network and health.

mod cgroup;
mod docker;

pub use docker::DockerError;
use docker::ListedContainer;
use otterd_engine::DockerClient;

use crate::paths::HostPaths;
use crate::rate::Rates;
use crate::reading::{ContainerHealth, ContainerSample};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, Instant};

/// The label the product puts on every container it runs.
pub const RESOURCE_LABEL: &str = "otterdeploy.resource.id";

/// How long a container list is reused. Listing containers is the one
/// Engine call a round makes, and at a 1 s live cadence on a node with 100
/// containers it costs dockerd about a fifth of a core; reusing the list for
/// 10 s cuts that tenfold. A container started in between shows up within
/// this age; one that stopped drops out at once, because its cgroup is gone.
pub const DEFAULT_LIST_MAX_AGE: Duration = Duration::from_secs(10);

#[derive(Debug)]
pub struct ContainerCollector {
    docker: DockerClient,
    paths: HostPaths,
    cpu: Rates<String, 1>,
    net: Rates<String, 2>,
    cgroups: HashMap<String, PathBuf>,
    list: Option<(Instant, Vec<ListedContainer>)>,
    list_max_age: Duration,
}

impl ContainerCollector {
    pub fn new(docker: DockerClient, paths: HostPaths) -> Self {
        Self {
            docker,
            paths,
            cpu: Rates::default(),
            net: Rates::default(),
            cgroups: HashMap::new(),
            list: None,
            list_max_age: DEFAULT_LIST_MAX_AGE,
        }
    }

    /// Reuse a container list for up to `age` (zero lists every round).
    #[must_use]
    pub fn with_list_max_age(mut self, age: Duration) -> Self {
        self.list_max_age = age;
        self
    }

    /// One round over every running container.
    ///
    /// # Errors
    /// The engine could not be asked for its containers; the round then has
    /// no container figures at all rather than stale ones.
    pub(crate) async fn collect(
        &mut self,
        now: Instant,
    ) -> Result<Vec<ContainerSample>, DockerError> {
        let (listed, reused) = match self.list.take() {
            Some((at, list)) if now.saturating_duration_since(at) < self.list_max_age => (list, at),
            _ => (docker::list_running(&self.docker).await?, now),
        };
        let fresh = reused == now;
        let mut samples = Vec::with_capacity(listed.len());
        for c in &listed {
            // A reused list may name a container that has since stopped;
            // its cgroup is gone, so it is left out rather than reported
            // with nothing measured.
            if !fresh && cgroup::locate(&self.paths, &c.id).is_none() {
                continue;
            }
            samples.push(self.sample(c, now));
        }
        self.cpu.retain_seen();
        self.net.retain_seen();
        self.cgroups
            .retain(|id, _| listed.iter().any(|c| &c.id == id));
        self.list = Some((reused, listed));
        Ok(samples)
    }

    fn sample(&mut self, c: &ListedContainer, now: Instant) -> ContainerSample {
        let dir = match self.cgroups.get(&c.id) {
            Some(dir) => Some(dir.clone()),
            None => cgroup::locate(&self.paths, &c.id).inspect(|d| {
                self.cgroups.insert(c.id.clone(), d.clone());
            }),
        };
        let reading = dir.as_deref().map(cgroup::read).unwrap_or_default();
        let cpu_pct = reading
            .cpu_usage_usec
            .and_then(|u| self.cpu.observe(&c.id, [u], now))
            // microseconds of CPU per second / 1e6 * 100 %
            .map(|[usec_per_s]| {
                #[allow(clippy::cast_possible_truncation)]
                let pct = (usec_per_s / 10_000.0) as f32;
                pct
            });
        let net = reading
            .pid
            .and_then(|pid| std::fs::read_to_string(self.paths.proc(format!("{pid}/net/dev"))).ok())
            .map(|t| crate::host::namespace_totals(&t))
            .and_then(|(rx, tx)| self.net.observe(&c.id, [rx, tx], now));
        ContainerSample {
            container_id: c.id.clone(),
            name: c.name().to_string(),
            resource_id: c.label(RESOURCE_LABEL).map(str::to_string),
            health: health_of(&c.status),
            cpu_pct,
            memory_bytes: reading.memory_bytes,
            memory_limit_bytes: reading.memory_limit_bytes,
            net_rx_bytes_per_s: net.map(|r| r[0]),
            net_tx_bytes_per_s: net.map(|r| r[1]),
        }
    }
}

/// Docker reports health only inside the human status string:
/// `Up 3 minutes (healthy)`, `(unhealthy)`, `(health: starting)`.
fn health_of(status: &str) -> Option<ContainerHealth> {
    if status.ends_with("(healthy)") {
        Some(ContainerHealth::Healthy)
    } else if status.ends_with("(unhealthy)") {
        Some(ContainerHealth::Unhealthy)
    } else if status.ends_with("(health: starting)") {
        Some(ContainerHealth::Starting)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// An Engine socket that answers every request with `body` and counts them.
    fn fake_engine(socket: &std::path::Path, body: &'static str) -> Arc<AtomicUsize> {
        let calls = Arc::new(AtomicUsize::new(0));
        let listener = tokio::net::UnixListener::bind(socket).unwrap();
        let counter = calls.clone();
        tokio::spawn(async move {
            while let Ok((mut s, _)) = listener.accept().await {
                counter.fetch_add(1, Ordering::SeqCst);
                let mut buf = [0u8; 1024];
                let _ = s.read(&mut buf).await;
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
                    body.len()
                );
                let _ = s.write_all(resp.as_bytes()).await;
            }
        });
        calls
    }

    #[tokio::test]
    async fn the_container_list_is_reused_and_stopped_containers_drop_out() {
        let root = tempfile::tempdir().unwrap();
        let cg = root
            .path()
            .join("sys/fs/cgroup/system.slice/docker-abc.scope");
        std::fs::create_dir_all(&cg).unwrap();
        std::fs::write(cg.join("cpu.stat"), "usage_usec 1000\n").unwrap();
        std::fs::write(cg.join("memory.current"), "4096\n").unwrap();
        let sock = root.path().join("docker.sock");
        let calls = fake_engine(
            &sock,
            r#"[{"Id":"abc","Names":["/web"],"Status":"Up 1 minute"}]"#,
        );
        let paths = HostPaths::new(root.path().join("proc"), root.path().join("sys"));
        let mut c =
            ContainerCollector::new(DockerClient::new(&sock, Duration::from_secs(2)), paths);
        let t0 = Instant::now();
        assert_eq!(c.collect(t0).await.unwrap().len(), 1);
        assert_eq!(
            c.collect(t0 + Duration::from_secs(1)).await.unwrap().len(),
            1
        );
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "second round reused the list"
        );
        // the container stops: its cgroup goes away before the list is refreshed
        std::fs::remove_dir_all(&cg).unwrap();
        assert!(
            c.collect(t0 + Duration::from_secs(2))
                .await
                .unwrap()
                .is_empty()
        );
        // past the maximum age the list is asked for again
        let _ = c.collect(t0 + Duration::from_secs(12)).await.unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn health_comes_from_the_status_suffix() {
        assert_eq!(
            health_of("Up 3 minutes (healthy)"),
            Some(ContainerHealth::Healthy)
        );
        assert_eq!(
            health_of("Up 1 hour (unhealthy)"),
            Some(ContainerHealth::Unhealthy)
        );
        assert_eq!(
            health_of("Up 2 seconds (health: starting)"),
            Some(ContainerHealth::Starting)
        );
        assert_eq!(health_of("Up 5 minutes"), None);
    }
}
