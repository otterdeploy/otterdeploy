//! The node network reconciler.
//!
//! One loop, one thread of mutation, so reconciles are serialized without a lock that a
//! daemon restart could wedge. Triggers: kernel link events (new veths, even with Docker down),
//! a change of Docker's main PID (a daemon restart with live-restore creates no new veth),
//! a changed policy file, and a periodic resync. Each pass:
//!
//! 1. reloads the policy if its file changed, applies it atomically and withdraws conntrack
//!    state for revoked pairs;
//! 2. if Docker is active (asked of systemd, never of the daemon), reconciles the bridge guard
//!    and the Docker-chain positions, or decides the Docker-side recovery after a flush;
//! 3. audits otterd's tables and reloads the persisted generation on drift.
//!
//! The loop pets the systemd watchdog only after a pass completes, so a wedged reconciler is
//! restarted (with `Restart=always` and no start-limit latch on the unit).

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant, SystemTime};

use crate::cmd::Runner;
use crate::docker::{self, ContainerSource};
use crate::firewall::{
    self, Audit, AuditOutcome, DockerChainState, DockerChains, DockerFacts, DockerRecovery,
    Firewall,
};
use crate::guard::{self, HostLinks};
use crate::policy::{self, NodePolicy};

/// Tunables.
#[derive(Debug, Clone)]
pub struct Options {
    /// Policy file (JSON [`NodePolicy`]) written by otterd.
    pub policy_file: PathBuf,
    /// Firewall layout.
    pub layout: firewall::Layout,
    /// Full resync period even without triggers.
    pub resync: Duration,
    /// Audit period.
    pub audit: Duration,
    /// Remove the installer's volatile `DOCKER-USER` guard once otterd's replacement is loaded.
    pub replace_installer_guard: bool,
    /// Restart Docker automatically when its rules vanished (a ruleset flush).
    pub docker_recovery: bool,
    /// Minimum spacing between automatic Docker restarts.
    pub docker_recovery_backoff: Duration,
    /// Facts for the recovery decision that the network layer cannot observe itself.
    pub docker: DockerProfile,
}

/// How this node's Docker daemon is configured, as journalled by otterd.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DockerProfile {
    /// The node is still a Swarm member (before finalize).
    pub swarm_member: bool,
    /// live-restore is set.
    pub live_restore: bool,
}

impl Options {
    /// Defaults for a policy file.
    #[must_use]
    pub fn new(policy_file: PathBuf) -> Self {
        Self {
            policy_file,
            layout: firewall::Layout::default(),
            resync: Duration::from_secs(15),
            audit: Duration::from_secs(5),
            replace_installer_guard: true,
            docker_recovery: true,
            docker_recovery_backoff: Duration::from_secs(30),
            docker: DockerProfile::default(),
        }
    }
}

/// Why a pass failed.
#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    /// The policy file cannot be read or parsed.
    #[error("policy file {path}: {why}")]
    Policy {
        /// Path.
        path: PathBuf,
        /// Reason.
        why: String,
    },
    /// A firewall operation failed.
    #[error(transparent)]
    Firewall(#[from] firewall::FirewallError),
    /// A command failed.
    #[error(transparent)]
    Cmd(#[from] crate::cmd::CmdError),
}

/// Reads and parses a policy file.
///
/// # Errors
/// [`AgentError::Policy`].
pub fn load_policy(path: &std::path::Path) -> Result<NodePolicy, AgentError> {
    let text = std::fs::read_to_string(path).map_err(|e| AgentError::Policy {
        path: path.to_owned(),
        why: e.to_string(),
    })?;
    serde_json::from_str(&text).map_err(|e| AgentError::Policy {
        path: path.to_owned(),
        why: e.to_string(),
    })
}

/// What happened in one pass, for logs and tests.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct PassReport {
    /// A new policy generation was applied.
    pub policy_applied: bool,
    /// Conntrack entries deleted for revoked pairs.
    pub withdrawn: u64,
    /// Guard entries after this pass, if the guard was reconciled.
    pub guarded: Option<usize>,
    /// Docker-chain changes.
    pub docker_chains: Option<firewall::Changes>,
    /// Docker-side recovery decided.
    pub recovery: Option<DockerRecovery>,
    /// Audit outcome.
    pub audit: Option<AuditOutcome>,
}

/// The reconciler state.
#[derive(Debug)]
pub struct Agent<R: Runner, S: ContainerSource> {
    runner: R,
    source: S,
    opts: Options,
    policy: Option<NodePolicy>,
    policy_mtime: Option<SystemTime>,
    guard_text: Option<String>,
    docker_pid: Option<u32>,
    last_recovery: Option<Instant>,
    chains_missing_since: Option<Instant>,
    last_audit: Option<Instant>,
    last_resync: Option<Instant>,
    audit: Audit,
}

impl<R: Runner, S: ContainerSource> Agent<R, S> {
    /// A reconciler that has not run yet.
    pub fn new(runner: R, source: S, opts: Options) -> Self {
        Self {
            runner,
            source,
            opts,
            policy: None,
            policy_mtime: None,
            guard_text: None,
            docker_pid: None,
            last_recovery: None,
            chains_missing_since: None,
            last_audit: None,
            last_resync: None,
            audit: Audit::default(),
        }
    }

    fn firewall(&self) -> Firewall<'_, R> {
        Firewall::new(self.opts.layout.clone(), &self.runner)
    }

    /// One reconcile pass. `links_changed` forces a guard reconcile.
    ///
    /// # Errors
    /// The first failing step; later steps are skipped and retried on the next pass.
    pub fn pass(&mut self, links_changed: bool) -> Result<PassReport, AgentError> {
        let mut report = PassReport::default();
        let now = Instant::now();

        let mtime = std::fs::metadata(&self.opts.policy_file)
            .and_then(|m| m.modified())
            .ok();
        if self.policy.is_none() || mtime != self.policy_mtime {
            let next = load_policy(&self.opts.policy_file)?;
            self.firewall().apply_policy(&next)?;
            if let Some(old) = &self.policy {
                for (src, dst) in crate::conntrack::revoked(old, &next) {
                    report.withdrawn += crate::conntrack::withdraw(&self.runner, src, dst)?;
                }
            }
            self.policy = Some(next);
            self.policy_mtime = mtime;
            report.policy_applied = true;
            let fp = self.firewall().fingerprint()?;
            self.audit.accept(&fp);
        }
        let Some(policy) = self.policy.clone() else {
            return Ok(report);
        };

        if docker::docker_active(&self.runner) {
            let pid = docker::docker_main_pid(&self.runner);
            let restarted = pid != self.docker_pid;
            self.docker_pid = pid;
            let resync_due = self
                .last_resync
                .is_none_or(|t| now.duration_since(t) >= self.opts.resync);
            let audit_due = self
                .last_audit
                .is_none_or(|t| now.duration_since(t) >= self.opts.audit);
            let guard_due = links_changed || restarted || resync_due || self.guard_text.is_none();
            if guard_due {
                report.guarded = Some(self.reconcile_guard(&policy)?);
                self.last_resync = Some(now);
            }
            if guard_due || audit_due {
                self.docker_side(&policy, now, &mut report)?;
            }
        }

        if self
            .last_audit
            .is_none_or(|t| now.duration_since(t) >= self.opts.audit)
        {
            let fw = Firewall::new(self.opts.layout.clone(), &self.runner);
            let outcome = self.audit.check(&fw)?;
            if let AuditOutcome::Repaired { missing, changed } = &outcome {
                tracing::warn!(
                    ?missing,
                    changed,
                    "node.firewall.drift: otterd tables re-applied"
                );
            }
            report.audit = Some(outcome);
            self.last_audit = Some(now);
        }
        Ok(report)
    }

    fn docker_side(
        &mut self,
        policy: &NodePolicy,
        now: Instant,
        report: &mut PassReport,
    ) -> Result<(), AgentError> {
        {
            let chains = DockerChains::new(&self.runner);
            match chains.state()? {
                DockerChainState::Present => {
                    self.chains_missing_since = None;
                    report.docker_chains =
                        Some(chains.ensure(policy, self.opts.replace_installer_guard)?);
                }
                DockerChainState::Missing => {
                    let facts = DockerFacts {
                        active: true,
                        swarm_member: self.opts.docker.swarm_member,
                        live_restore: self.opts.docker.live_restore,
                    };
                    let decision = firewall::docker_recovery(DockerChainState::Missing, facts);
                    // Act only if the chains stay missing: a daemon that just went active may still
                    // be creating them.
                    let since = *self.chains_missing_since.get_or_insert(now);
                    let settled = now.duration_since(since) >= Duration::from_secs(5);
                    let backoff_ok = settled
                        && self.last_recovery.is_none_or(|t| {
                            now.duration_since(t) >= self.opts.docker_recovery_backoff
                        });
                    if let DockerRecovery::Restart { kills_containers } = decision
                        && self.opts.docker_recovery
                        && backoff_ok
                    {
                        tracing::warn!(
                            kills_containers,
                            "Docker's rules are gone; restarting Docker to re-create them"
                        );
                        self.last_recovery = Some(now);
                        // --no-block: never wait on Docker from the reconcile loop.
                        self.runner.ok(
                            "systemctl",
                            &["--no-block", "restart", "docker.service"],
                            None,
                        )?;
                    }
                    report.recovery = Some(decision);
                }
            }
        }
        Ok(())
    }

    fn reconcile_guard(&mut self, policy: &NodePolicy) -> Result<usize, AgentError> {
        let ifaces = match self.source.interfaces() {
            Ok(i) => i,
            Err(e) => {
                // Keep the current generation; new veths stay under the default drop.
                tracing::warn!(error = %e, "docker unreadable; bridge guard unchanged");
                return Ok(0);
            }
        };
        let host = HostLinks::read(std::path::Path::new("/sys/class/net")).map_err(|e| {
            AgentError::Policy {
                path: "/sys/class/net".into(),
                why: e.to_string(),
            }
        })?;
        let veths = guard::resolve_veths(&self.runner, &ifaces, &host, &policy.interfaces.bridges);
        let text = policy::render_bridge_guard(&policy.interfaces.bridges, &veths);
        if self.guard_text.as_deref() != Some(text.as_str()) {
            self.firewall().apply_guard(&text)?;
            self.guard_text = Some(text);
            let fp = self.firewall().fingerprint()?;
            self.audit.accept(&fp);
        }
        Ok(veths.len())
    }
}

/// Runs the agent until `stop` is set. Link events come from a monitor thread; every pass that
/// completes pets the systemd watchdog.
pub fn run<R: Runner, S: ContainerSource>(mut agent: Agent<R, S>, stop: &Arc<AtomicBool>) {
    let notifier = otterd_sys::notify::Notifier::from_env();
    let (tx, rx) = mpsc::sync_channel::<()>(1);
    #[cfg(target_os = "linux")]
    {
        let stop = Arc::clone(stop);
        std::thread::spawn(move || match crate::netlink::LinkMonitor::open() {
            Ok(m) => {
                while !stop.load(Ordering::Relaxed) {
                    match m.wait(Duration::from_secs(1)) {
                        Ok(crate::netlink::LinkEvent::Changed) => {
                            let _ = tx.try_send(());
                        }
                        Ok(crate::netlink::LinkEvent::Idle) => {}
                        Err(e) => {
                            tracing::error!(error = %e, "link monitor failed; relying on periodic resync");
                            return;
                        }
                    }
                }
            }
            Err(e) => {
                tracing::error!(error = %e, "link monitor unavailable; relying on periodic resync");
            }
        });
    }
    #[cfg(not(target_os = "linux"))]
    drop(tx);
    let mut pending = true;
    while !stop.load(Ordering::Relaxed) {
        match agent.pass(pending) {
            Ok(r) => {
                if r.policy_applied
                    || r.audit.as_ref().is_some_and(|a| *a != AuditOutcome::Clean)
                    || r.withdrawn > 0
                {
                    tracing::info!(?r, "network pass");
                }
                let _ = notifier.watchdog();
            }
            Err(e) => tracing::error!(error = %e, "network pass failed"),
        }
        pending = matches!(rx.recv_timeout(Duration::from_secs(1)), Ok(()));
        if pending {
            // Coalesce a burst (a container start creates several links).
            std::thread::sleep(Duration::from_millis(50));
            while rx.try_recv().is_ok() {}
        }
    }
}
