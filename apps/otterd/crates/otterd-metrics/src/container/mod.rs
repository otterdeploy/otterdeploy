//! Per-container CPU, memory, network and health.

mod cgroup;
mod docker;

use docker::ListedContainer;
pub use docker::{DockerClient, DockerError};

use crate::paths::HostPaths;
use crate::rate::Rates;
use crate::reading::{ContainerHealth, ContainerSample};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Instant;

/// The label the product puts on every container it runs.
pub const RESOURCE_LABEL: &str = "otterdeploy.resource.id";

#[derive(Debug)]
pub struct ContainerCollector {
    docker: DockerClient,
    paths: HostPaths,
    cpu: Rates<String, 1>,
    net: Rates<String, 2>,
    cgroups: HashMap<String, PathBuf>,
}

impl ContainerCollector {
    pub fn new(docker: DockerClient, paths: HostPaths) -> Self {
        Self {
            docker,
            paths,
            cpu: Rates::default(),
            net: Rates::default(),
            cgroups: HashMap::new(),
        }
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
        let listed = self.docker.list_running().await?;
        let mut samples = Vec::with_capacity(listed.len());
        for c in &listed {
            samples.push(self.sample(c, now));
        }
        self.cpu.retain_seen();
        self.net.retain_seen();
        self.cgroups
            .retain(|id, _| listed.iter().any(|c| &c.id == id));
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
