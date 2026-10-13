//! Firewall persistence, systemd integration and Docker-chain positioning.
//!
//! Hazards this module answers:
//!
//! 1. `nftables.service` flushes everything on stop, and `/etc/nftables.conf` itself starts with
//!    `flush ruleset`. `otterd-firewall.service` reloads the last persisted generation (ordered
//!    `After=`/`PartOf=nftables.service`, `Before=docker.service`), and a drop-in for nftables.service makes
//!    nftables start/reload load the distro file **and** otterd's files in one `nft -f`
//!    transaction, with an empty stop. Measured 0 policy-denied datagrams on restart and stop.
//! 2. The installer's `DOCKER-USER` guard is volatile and TCP-only: its persistent TCP+UDP
//!    replacement lives in otterd's filter table ([`crate::policy`]); [`DockerChains`] removes the
//!    nft-native original so iptables introspection of the chain works again.
//! 3. Position matters: the `DOCKER-USER` jump must be first (checked by nft handle) and the no-SNAT
//!    `RETURN` must head nat `POSTROUTING`.
//!
//! Persisted files are written atomically (temp file, fsync, rename, fsync of the directory).

use std::fmt::Write as _;
use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::addr::Ipv4Net;
use crate::cmd::{CmdError, Runner};
use crate::policy::{self, NodePolicy, tables};

/// Where otterd keeps its firewall state and how the host is laid out.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layout {
    /// otterd's firewall state directory.
    pub state_dir: PathBuf,
    /// The distro nftables config the nftables.service wrapper includes first.
    pub distro_conf: PathBuf,
    /// systemd unit directory for otterd's units and drop-ins.
    pub unit_dir: PathBuf,
    /// `nft` binary.
    pub nft: PathBuf,
}

impl Default for Layout {
    fn default() -> Self {
        Self {
            state_dir: PathBuf::from("/var/lib/otterd/firewall"),
            distro_conf: PathBuf::from("/etc/nftables.conf"),
            unit_dir: PathBuf::from("/etc/systemd/system"),
            nft: PathBuf::from("/usr/sbin/nft"),
        }
    }
}

/// Name of otterd's firewall unit.
pub const FIREWALL_UNIT: &str = "otterd-firewall.service";

impl Layout {
    /// Last applied policy generation (filter, NAT, VIP baseline).
    #[must_use]
    pub fn policy_file(&self) -> PathBuf {
        self.state_dir.join("policy.nft")
    }

    /// Last reconciled bridge-guard generation.
    #[must_use]
    pub fn guard_file(&self) -> PathBuf {
        self.state_dir.join("guard.nft")
    }

    /// What `otterd-firewall.service` loads: otterd's files only.
    #[must_use]
    pub fn load_file(&self) -> PathBuf {
        self.state_dir.join("load.nft")
    }

    /// What nftables.service loads under otterd's drop-in: the distro file, then otterd's.
    #[must_use]
    pub fn wrapper_file(&self) -> PathBuf {
        self.state_dir.join("nftables-wrapper.nft")
    }

    fn includes(&self) -> String {
        format!(
            "include \"{}\"\ninclude \"{}\"\n",
            self.policy_file().display(),
            self.guard_file().display()
        )
    }

    /// Text of [`Layout::load_file`].
    #[must_use]
    pub fn render_load(&self) -> String {
        self.includes()
    }

    /// Text of [`Layout::wrapper_file`]. The distro file is included, never edited.
    #[must_use]
    pub fn render_wrapper(&self) -> String {
        format!(
            "include \"{}\"\n{}",
            self.distro_conf.display(),
            self.includes()
        )
    }

    /// `otterd-firewall.service`: loads the persisted generation before Docker and the network,
    /// and again whenever nftables.service restarts (`PartOf=`). It runs `nft` directly, so a
    /// broken or missing otterd binary cannot leave the host open.
    #[must_use]
    pub fn render_firewall_unit(&self) -> String {
        format!(
            "[Unit]\n\
             Description=otterd packet policy (fail-closed, loaded before Docker)\n\
             DefaultDependencies=no\n\
             Wants=network-pre.target\n\
             Before=docker.service network-pre.target shutdown.target\n\
             After=local-fs.target nftables.service\n\
             PartOf=nftables.service\n\
             Conflicts=shutdown.target\n\
             ConditionPathExists={load}\n\
             \n\
             [Service]\n\
             Type=oneshot\n\
             RemainAfterExit=yes\n\
             ExecStart={nft} -f {load}\n\
             ExecReload={nft} -f {load}\n\
             \n\
             [Install]\n\
             WantedBy=multi-user.target\n",
            nft = self.nft.display(),
            load = self.load_file().display(),
        )
    }

    /// The drop-in for `nftables.service`: stop does not flush, start and reload are one
    /// transaction of the distro file plus otterd's generation.
    #[must_use]
    pub fn render_nftables_dropin(&self) -> String {
        format!(
            "# otterd: stop must not flush the ruleset, and start/reload must load the distro\n\
             # file and otterd's tables in one transaction (the distro file begins with\n\
             # `flush ruleset`). The distro file itself is not modified.\n\
             [Service]\n\
             ExecStart=\n\
             ExecStart={nft} -f {w}\n\
             ExecReload=\n\
             ExecReload={nft} -f {w}\n\
             ExecStop=\n",
            nft = self.nft.display(),
            w = self.wrapper_file().display(),
        )
    }

    /// Docker drop-in: Docker starts only after the policy is in place.
    #[must_use]
    pub fn render_docker_dropin() -> String {
        format!("[Unit]\nAfter={FIREWALL_UNIT}\nWants={FIREWALL_UNIT}\n")
    }

    /// Every file the firewall integration installs, as (path, contents).
    #[must_use]
    pub fn unit_files(&self) -> Vec<(PathBuf, String)> {
        vec![
            (
                self.unit_dir.join(FIREWALL_UNIT),
                self.render_firewall_unit(),
            ),
            (
                self.unit_dir.join("nftables.service.d/otterd.conf"),
                self.render_nftables_dropin(),
            ),
            (
                self.unit_dir.join("docker.service.d/otterd-firewall.conf"),
                Self::render_docker_dropin(),
            ),
        ]
    }
}

/// A firewall operation that failed.
#[derive(Debug, thiserror::Error)]
pub enum FirewallError {
    /// Writing a persisted file failed.
    #[error("writing {path}: {source}")]
    Io {
        /// The file.
        path: PathBuf,
        /// Cause.
        #[source]
        source: std::io::Error,
    },
    /// An external command failed.
    #[error(transparent)]
    Cmd(#[from] CmdError),
    /// The ruleset was rejected by `nft -c`; nothing was changed.
    #[error("nft rejected the generation: {0}")]
    Rejected(String),
}

static WRITE_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Writes `contents` to `path` atomically and durably.
///
/// # Errors
/// [`FirewallError::Io`].
pub fn write_atomic(path: &Path, contents: &str) -> Result<(), FirewallError> {
    let io = |source| FirewallError::Io {
        path: path.to_owned(),
        source,
    };
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(dir).map_err(io)?;
    let seq = WRITE_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    // Unique per process and call: concurrent writers never share a temp file.
    let tmp = dir.join(format!(".{name}.{}.{seq}.tmp", std::process::id()));
    {
        let mut f = fs::File::create(&tmp).map_err(io)?;
        f.write_all(contents.as_bytes()).map_err(io)?;
        f.sync_all().map_err(io)?;
    }
    fs::rename(&tmp, path).map_err(io)?;
    fs::File::open(dir).and_then(|d| d.sync_all()).map_err(io)?;
    Ok(())
}

/// An exclusive `flock` on the state directory's lock file, released on drop.
#[derive(Debug)]
struct StateLock {
    // Held only for its descriptor: closing it releases the lock.
    _file: fs::File,
}

impl StateLock {
    fn acquire(dir: &Path) -> Result<Self, FirewallError> {
        let path = dir.join(".lock");
        let io = |source| FirewallError::Io {
            path: path.clone(),
            source,
        };
        fs::create_dir_all(dir).map_err(io)?;
        let f = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(&path)
            .map_err(io)?;
        rustix::fs::flock(&f, rustix::fs::FlockOperation::LockExclusive)
            .map_err(|e| io(e.into()))?;
        Ok(Self { _file: f })
    }
}

/// Applies and persists generations through `nft`.
#[derive(Debug)]
pub struct Firewall<'r, R: Runner> {
    layout: Layout,
    runner: &'r R,
}

impl<'r, R: Runner> Firewall<'r, R> {
    /// A firewall over `layout`.
    pub const fn new(layout: Layout, runner: &'r R) -> Self {
        Self { layout, runner }
    }

    /// The layout.
    pub const fn layout(&self) -> &Layout {
        &self.layout
    }

    fn nft(&self, args: &[&str], stdin: Option<&str>) -> Result<String, FirewallError> {
        let nft = self.layout.nft.to_string_lossy();
        Ok(self.runner.ok(&nft, args, stdin)?.stdout)
    }

    /// Checks `text` with `nft -c`, applies it in one transaction, then persists it to `file`.
    /// The live ruleset changes first: a crash between apply and persist leaves the previous
    /// (still safe, deny-by-default) generation on disk.
    fn apply_and_persist(&self, file: &Path, text: &str) -> Result<(), FirewallError> {
        // One writer at a time across processes (the reconciler and an operator command), so the
        // persisted generation is always the one last applied.
        let _lock = StateLock::acquire(&self.layout.state_dir)?;
        self.nft(&["-c", "-f", "-"], Some(text))
            .map_err(|e| match e {
                FirewallError::Cmd(CmdError::Failed { stderr, .. }) => {
                    FirewallError::Rejected(stderr)
                }
                other => other,
            })?;
        self.nft(&["-f", "-"], Some(text))?;
        write_atomic(file, text)
    }

    /// Installs a policy generation (filter, NAT, VIP baseline) atomically and persists it.
    ///
    /// # Errors
    /// [`FirewallError::Rejected`] leaves the live ruleset untouched.
    pub fn apply_policy(&self, policy: &NodePolicy) -> Result<(), FirewallError> {
        self.apply_and_persist(&self.layout.policy_file(), &policy.render())
    }

    /// Installs a bridge-guard generation and persists it.
    ///
    /// # Errors
    /// As [`Firewall::apply_policy`].
    pub fn apply_guard(&self, text: &str) -> Result<(), FirewallError> {
        self.apply_and_persist(&self.layout.guard_file(), text)
    }

    /// Writes the load file, wrapper and unit files, and makes sure a guard generation exists
    /// (a fresh node starts with the default-deny guard). Call `systemctl daemon-reload` after.
    ///
    /// # Errors
    /// [`FirewallError::Io`].
    pub fn install(&self, bridges: &policy::IfacePattern) -> Result<(), FirewallError> {
        if !self.layout.guard_file().exists() {
            write_atomic(
                &self.layout.guard_file(),
                &policy::render_bridge_guard(bridges, &[]),
            )?;
        }
        write_atomic(&self.layout.load_file(), &self.layout.render_load())?;
        write_atomic(&self.layout.wrapper_file(), &self.layout.render_wrapper())?;
        for (path, text) in self.layout.unit_files() {
            write_atomic(&path, &text)?;
        }
        Ok(())
    }

    /// Re-applies the persisted files in one transaction (what the unit does), used by the audit.
    ///
    /// # Errors
    /// [`FirewallError::Cmd`].
    pub fn reload_persisted(&self) -> Result<(), FirewallError> {
        let load = self.layout.load_file();
        self.nft(&["-f", &load.to_string_lossy()], None).map(|_| ())
    }

    /// A digest of otterd's static tables as the kernel holds them, without counters.
    /// `None` for a table means it is missing.
    ///
    /// # Errors
    /// [`FirewallError::Cmd`] if `nft` itself cannot run.
    pub fn fingerprint(&self) -> Result<Fingerprint, FirewallError> {
        let mut h = Sha256::new();
        let mut missing = Vec::new();
        for (family, name) in OWNED_TABLES {
            let nft = self.layout.nft.to_string_lossy();
            let out = self.runner.run(
                &nft,
                &["-s", "list", "table", family, name],
                None,
                crate::cmd::DEFAULT_TIMEOUT,
            )?;
            if out.success() {
                h.update(family.as_bytes());
                h.update(name.as_bytes());
                h.update(out.stdout.as_bytes());
            } else {
                missing.push(format!("{family} {name}"));
            }
        }
        Ok(Fingerprint {
            digest: hex::encode(h.finalize()),
            missing,
        })
    }
}

/// otterd's static tables, in load order.
pub const OWNED_TABLES: [(&str, &str); 4] = [
    ("inet", tables::FILTER),
    ("ip", tables::NAT),
    ("ip", tables::VIP_BASELINE),
    ("bridge", tables::BRIDGE),
];

/// What the kernel currently holds for otterd's tables.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fingerprint {
    /// Digest over every present table's stateless listing.
    pub digest: String,
    /// Tables that are gone (a flush, a manual delete).
    pub missing: Vec<String>,
}

/// Outcome of one audit pass.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuditOutcome {
    /// Matches the last applied generation.
    Clean,
    /// Tables missing or changed; re-applied. Raise `node.firewall.drift`.
    Repaired {
        /// What was found.
        missing: Vec<String>,
        /// Whether the contents differed (not only missing tables).
        changed: bool,
    },
}

/// Remembers the expected fingerprint and repairs drift.
#[derive(Debug, Default)]
pub struct Audit {
    expected: Option<String>,
}

impl Audit {
    /// Records the fingerprint right after a successful apply.
    pub fn accept(&mut self, fp: &Fingerprint) {
        self.expected = Some(fp.digest.clone());
    }

    /// Compares the live tables with the expected generation and reloads the persisted files on
    /// drift. Before the first [`Audit::accept`] only missing tables count as drift.
    ///
    /// # Errors
    /// The reload failed; the caller retries on its next tick.
    pub fn check<R: Runner>(
        &mut self,
        fw: &Firewall<'_, R>,
    ) -> Result<AuditOutcome, FirewallError> {
        let fp = fw.fingerprint()?;
        let changed = self.expected.as_ref().is_some_and(|e| *e != fp.digest);
        if fp.missing.is_empty() && !changed {
            return Ok(AuditOutcome::Clean);
        }
        fw.reload_persisted()?;
        let after = fw.fingerprint()?;
        self.expected = Some(after.digest);
        Ok(AuditOutcome::Repaired {
            missing: fp.missing,
            changed,
        })
    }
}

/// Positions otterd's rules inside Docker's iptables-nft tables.
#[derive(Debug)]
pub struct DockerChains<'r, R: Runner> {
    runner: &'r R,
}

/// State of Docker's own chains.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DockerChainState {
    /// `DOCKER-USER` and nat `DOCKER` exist.
    Present,
    /// Docker's tables are gone (a ruleset flush) while Docker runs: published ports and NAT are
    /// dead until Docker re-creates them.
    Missing,
}

/// An installer guard rule left in `DOCKER-USER`.
const INSTALLER_GUARD_COMMENT: &str = "otterdeploy-guard";

impl<'r, R: Runner> DockerChains<'r, R> {
    /// Over `runner`.
    pub const fn new(runner: &'r R) -> Self {
        Self { runner }
    }

    /// Whether Docker's chains exist.
    ///
    /// # Errors
    /// `nft` could not run.
    pub fn state(&self) -> Result<DockerChainState, CmdError> {
        let user = self.runner.run(
            "nft",
            &["list", "chain", "ip", "filter", "DOCKER-USER"],
            None,
            crate::cmd::DEFAULT_TIMEOUT,
        )?;
        let nat = self.runner.run(
            "nft",
            &["list", "chain", "ip", "nat", "DOCKER"],
            None,
            crate::cmd::DEFAULT_TIMEOUT,
        )?;
        Ok(if user.success() && nat.success() {
            DockerChainState::Present
        } else {
            DockerChainState::Missing
        })
    }

    /// Loads the `OTTERD-MESH` chain, makes the `DOCKER-USER` jump the first rule, optionally
    /// removes the installer's volatile guard, and puts the no-SNAT `RETURN`s at the head of nat
    /// `POSTROUTING`. Idempotent; does nothing to a chain that is already right.
    ///
    /// # Errors
    /// Any failed command. Callers check [`DockerChains::state`] first.
    pub fn ensure(
        &self,
        policy: &NodePolicy,
        remove_installer_guard: bool,
    ) -> Result<Changes, CmdError> {
        let mut changes = Changes::default();
        self.runner.ok(
            "iptables-restore",
            &["-w", "5", "--noflush"],
            Some(&policy.render_docker_chain()),
        )?;
        let listing = self
            .runner
            .ok(
                "nft",
                &["-a", "list", "chain", "ip", "filter", "DOCKER-USER"],
                None,
            )?
            .stdout;
        let rules = parse_handles(&listing);
        let jump = format!("jump {}", tables::DOCKER_CHAIN);
        let mut stale: Vec<u64> = Vec::new();
        let first_ok = rules.first().is_some_and(|(r, _)| r.contains(&jump));
        for (i, (rule, handle)) in rules.iter().enumerate() {
            let stale_jump = rule.contains(&jump) && !(first_ok && i == 0);
            let guard = remove_installer_guard && rule.contains(INSTALLER_GUARD_COMMENT);
            if stale_jump || guard {
                stale.push(*handle);
            }
            changes.removed_installer_guard |= guard;
        }
        for h in &stale {
            let h = h.to_string();
            self.runner.ok(
                "nft",
                &[
                    "delete",
                    "rule",
                    "ip",
                    "filter",
                    "DOCKER-USER",
                    "handle",
                    &h,
                ],
                None,
            )?;
        }
        if !first_ok {
            // iptables (not nft) so the rule stays iptables-compatible; -I works even while an
            // nft-native rule makes -S/-C/-D on this chain fail.
            self.runner.ok(
                "iptables",
                &[
                    "-w",
                    "5",
                    "-I",
                    "DOCKER-USER",
                    "1",
                    "-j",
                    tables::DOCKER_CHAIN,
                ],
                None,
            )?;
            changes.jump_repositioned = true;
        }
        changes.no_snat_repositioned =
            self.ensure_no_snat(&policy.no_snat_prefixes(), policy.workload)?;
        Ok(changes)
    }

    fn ensure_no_snat(&self, sources: &[Ipv4Net], dest: Ipv4Net) -> Result<bool, CmdError> {
        let want: Vec<String> = sources
            .iter()
            .map(|s| format!("-A POSTROUTING -s {s} -d {dest} -j RETURN"))
            .collect();
        let listing = self
            .runner
            .ok(
                "iptables",
                &["-w", "5", "-t", "nat", "-S", "POSTROUTING"],
                None,
            )?
            .stdout;
        let rules: Vec<&str> = listing
            .lines()
            .filter(|l| l.starts_with("-A POSTROUTING"))
            .collect();
        if rules.len() >= want.len() && rules.iter().zip(&want).all(|(have, w)| have == w) {
            return Ok(false);
        }
        for w in &want {
            let spec: Vec<&str> = w.trim_start_matches("-A POSTROUTING ").split(' ').collect();
            loop {
                let mut args = vec!["-w", "5", "-t", "nat", "-D", "POSTROUTING"];
                args.extend(&spec);
                if !self
                    .runner
                    .run("iptables", &args, None, crate::cmd::DEFAULT_TIMEOUT)?
                    .success()
                {
                    break;
                }
            }
        }
        for (i, w) in want.iter().enumerate() {
            let pos = (i + 1).to_string();
            let mut args = vec!["-w", "5", "-t", "nat", "-I", "POSTROUTING", pos.as_str()];
            args.extend(w.trim_start_matches("-A POSTROUTING ").split(' '));
            self.runner.ok("iptables", &args, None)?;
        }
        Ok(true)
    }
}

/// What [`DockerChains::ensure`] changed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Changes {
    /// The jump was missing or not first.
    pub jump_repositioned: bool,
    /// The no-SNAT returns were missing or not at the head.
    pub no_snat_repositioned: bool,
    /// The installer's volatile guard was removed.
    pub removed_installer_guard: bool,
}

/// Rule text and handle for each rule in an `nft -a list chain` listing, in order.
#[must_use]
pub fn parse_handles(listing: &str) -> Vec<(String, u64)> {
    listing
        .lines()
        .filter_map(|l| {
            let (rule, h) = l.trim().rsplit_once("# handle ")?;
            let rule = rule.trim();
            if rule.is_empty()
                || rule.starts_with("chain ")
                || rule.starts_with("type ")
                || rule.starts_with("table ")
            {
                return None;
            }
            Some((rule.to_owned(), h.trim().parse().ok()?))
        })
        .collect()
}

/// Whether Docker must be restarted to bring back its own rules, and whether that is allowed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DockerRecovery {
    /// Nothing to do.
    None,
    /// Restart Docker. `kills_containers` is the honest cost without live-restore.
    Restart {
        /// Containers restart (no live-restore).
        kills_containers: bool,
    },
    /// A restart is needed but refused; raise it as a blocked preflight item.
    Blocked(String),
}

/// Facts about the Docker daemon relevant to a coordinated restart.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DockerFacts {
    /// `docker.service` is active.
    pub active: bool,
    /// The node is still a Swarm member.
    pub swarm_member: bool,
    /// live-restore is set (running config or `daemon.json`).
    pub live_restore: bool,
}

/// Decides the Docker-side recovery after otterd's tables are back. A Swarm member with
/// live-restore set is refused: the daemon would not start again.
#[must_use]
pub fn docker_recovery(chains: DockerChainState, facts: DockerFacts) -> DockerRecovery {
    if chains == DockerChainState::Present || !facts.active {
        return DockerRecovery::None;
    }
    if facts.swarm_member && facts.live_restore {
        return DockerRecovery::Blocked(
            "Docker's rules are gone, but this Swarm member has live-restore set: the next dockerd start would fail. \
             Set \"live-restore\": false explicitly and reload Docker, then otterd restarts it."
                .to_owned(),
        );
    }
    DockerRecovery::Restart {
        kills_containers: !facts.live_restore,
    }
}

/// A short human summary of a fingerprint, for logs.
#[must_use]
pub fn describe(fp: &Fingerprint) -> String {
    let mut s = fp.digest.chars().take(12).collect::<String>();
    if !fp.missing.is_empty() {
        let _ = write!(s, " missing: {}", fp.missing.join(", "));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cmd::fake::Fake;

    #[test]
    fn od2_dropin_empties_stop_and_loads_one_transaction() {
        let l = Layout::default();
        let d = l.render_nftables_dropin();
        assert!(d.contains("ExecStop=\n"));
        assert!(d.contains(
            "ExecStart=\nExecStart=/usr/sbin/nft -f /var/lib/otterd/firewall/nftables-wrapper.nft\n"
        ));
        assert!(d.contains("ExecReload=\nExecReload=/usr/sbin/nft -f /var/lib/otterd/firewall/nftables-wrapper.nft\n"));
        let w = l.render_wrapper();
        assert!(w.starts_with(
            "include \"/etc/nftables.conf\"\ninclude \"/var/lib/otterd/firewall/policy.nft\"\n"
        ));
        assert!(w.ends_with("include \"/var/lib/otterd/firewall/guard.nft\"\n"));
    }

    #[test]
    fn firewall_unit_is_ordered_before_docker_and_part_of_nftables() {
        let u = Layout::default().render_firewall_unit();
        for line in [
            "Before=docker.service network-pre.target shutdown.target",
            "After=local-fs.target nftables.service",
            "PartOf=nftables.service",
            "RemainAfterExit=yes",
            "ExecStart=/usr/sbin/nft -f /var/lib/otterd/firewall/load.nft",
        ] {
            assert!(u.contains(line), "{line}");
        }
        assert!(!u.contains("StartLimit"), "a oneshot must not latch");
    }

    #[test]
    fn concurrent_writers_do_not_collide() {
        let dir = std::env::temp_dir().join(format!("otterd-net-race-{}", std::process::id()));
        let f = dir.join("policy.nft");
        let handles: Vec<_> = (0..8)
            .map(|i| {
                let f = f.clone();
                std::thread::spawn(move || write_atomic(&f, &i.to_string()))
            })
            .collect();
        for h in handles {
            h.join().unwrap().unwrap();
        }
        assert!(fs::read_to_string(&f).unwrap().parse::<u8>().unwrap() < 8);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn write_atomic_replaces_content() {
        let dir = std::env::temp_dir().join(format!("otterd-net-test-{}", std::process::id()));
        let f = dir.join("x/y.nft");
        write_atomic(&f, "a").unwrap();
        write_atomic(&f, "b").unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "b");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rejected_generation_is_not_applied_or_persisted() {
        let fake = Fake::new().on("/usr/sbin/nft -c", 1, "");
        let dir = std::env::temp_dir().join(format!("otterd-net-rej-{}", std::process::id()));
        let fw = Firewall::new(
            Layout {
                state_dir: dir.clone(),
                ..Layout::default()
            },
            &fake,
        );
        let err = fw.apply_guard("garbage").unwrap_err();
        assert!(matches!(err, FirewallError::Rejected(_)));
        assert_eq!(fake.lines().len(), 1);
        assert!(!dir.join("guard.nft").exists());
    }

    const LISTING_GUARD_FIRST: &str = "table ip filter {\n\tchain DOCKER-USER { # handle 3\n\t\ttcp dport != { 80, 443 } ct state new counter packets 0 bytes 0 drop comment \"otterdeploy-guard\" # handle 40\n\t\tcounter packets 9 bytes 9 jump OTTERD-MESH # handle 41\n\t\tcounter packets 0 bytes 0 return # handle 4\n\t}\n}\n";

    #[test]
    fn handles_parse_in_order() {
        let h = parse_handles(LISTING_GUARD_FIRST);
        assert_eq!(
            h.iter().map(|(_, h)| *h).collect::<Vec<_>>(),
            vec![40, 41, 4]
        );
    }

    #[test]
    fn misplaced_jump_and_installer_guard_are_removed_and_the_jump_inserted_first() {
        let fake = Fake::new()
            .on("nft -a list chain ip filter DOCKER-USER", 0, LISTING_GUARD_FIRST)
            .on("iptables -w 5 -t nat -S POSTROUTING", 0, "-P POSTROUTING ACCEPT\n-A POSTROUTING -s 172.24.0.0/13 -d 172.24.0.0/13 -j RETURN\n");
        let policy = sample_policy();
        let c = DockerChains::new(&fake).ensure(&policy, true).unwrap();
        assert_eq!(
            c,
            Changes {
                jump_repositioned: true,
                no_snat_repositioned: false,
                removed_installer_guard: true
            }
        );
        let lines = fake.lines();
        assert!(
            lines
                .iter()
                .any(|l| l == "nft delete rule ip filter DOCKER-USER handle 40")
        );
        assert!(
            lines
                .iter()
                .any(|l| l == "nft delete rule ip filter DOCKER-USER handle 41")
        );
        assert!(
            lines
                .iter()
                .any(|l| l == "iptables -w 5 -I DOCKER-USER 1 -j OTTERD-MESH")
        );
    }

    #[test]
    fn no_snat_return_is_moved_to_the_head() {
        let fake = Fake::new()
            .on("nft -a list chain", 0, "\t\tcounter jump OTTERD-MESH # handle 9\n")
            .on("iptables -w 5 -t nat -S POSTROUTING", 0, "-P POSTROUTING ACCEPT\n-A POSTROUTING -s 172.17.0.0/16 ! -o docker0 -j MASQUERADE\n-A POSTROUTING -s 172.24.0.0/13 -d 172.24.0.0/13 -j RETURN\n")
            .on("iptables -w 5 -t nat -D", 1, "");
        let c = DockerChains::new(&fake)
            .ensure(&sample_policy(), false)
            .unwrap();
        assert!(c.no_snat_repositioned && !c.jump_repositioned);
        assert!(fake.lines().iter().any(|l| l == "iptables -w 5 -t nat -I POSTROUTING 1 -s 172.24.0.0/13 -d 172.24.0.0/13 -j RETURN"));
    }

    #[test]
    fn recovery_refuses_a_swarm_member_with_live_restore() {
        let f = |active, swarm_member, live_restore| DockerFacts {
            active,
            swarm_member,
            live_restore,
        };
        assert_eq!(
            docker_recovery(DockerChainState::Present, f(true, false, false)),
            DockerRecovery::None
        );
        assert_eq!(
            docker_recovery(DockerChainState::Missing, f(false, false, false)),
            DockerRecovery::None
        );
        assert_eq!(
            docker_recovery(DockerChainState::Missing, f(true, false, true)),
            DockerRecovery::Restart {
                kills_containers: false
            }
        );
        assert_eq!(
            docker_recovery(DockerChainState::Missing, f(true, true, false)),
            DockerRecovery::Restart {
                kills_containers: true
            }
        );
        assert!(matches!(
            docker_recovery(DockerChainState::Missing, f(true, true, true)),
            DockerRecovery::Blocked(_)
        ));
    }

    fn sample_policy() -> NodePolicy {
        NodePolicy {
            interfaces: policy::Interfaces::default(),
            workload: "172.24.0.0/13".parse().unwrap(),
            host_mesh: "172.30.224.0/23".parse().unwrap(),
            vip: "172.31.0.0/16".parse().unwrap(),
            pairs: std::collections::BTreeSet::new(),
            host_reach: std::collections::BTreeSet::new(),
            published: std::collections::BTreeSet::new(),
            edge_ports: [80, 443].into(),
            local_scopes: vec![],
            dns: vec![],
            no_snat_extra: vec![],
        }
    }
}
