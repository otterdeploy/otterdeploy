//! Per-request capabilities and replay protection.
//!
//! Every privileged read, mutation and stream carries a control-plane-signed
//! [`Capability`] bound to one node epoch, one session, one operation and the
//! SHA-256 of the exact command payload. The node checks it with
//! [`Capability::check`] before claiming the `opId` in its journal, and before any
//! side effect. A capability authorizes *initiation*: committed work is governed
//! by its durable operation state, never silently undone when the token expires.

use crate::ids::{
    AttemptId, GrantId, InstallId, NodeId, Nonce, OpId, OrgId, ResourceId, SessionId, Sha256Hex,
    SlotRef,
};
use crate::num::{DurationMs, U53, UnixMs};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Longest initiation validity the node accepts (`expiresAt − notBefore`).
pub const MAX_CAPABILITY_TTL_MS: u64 = 60_000;
/// Default bound on the wall-clock uncertainty a session may claim.
pub const MAX_CLOCK_UNCERTAINTY_MS: u64 = 5_000;
/// Outstanding nonces remembered per session. A full cache refuses new
/// capabilities rather than forgetting an unexpired nonce.
pub const NONCE_CACHE_CAPACITY: usize = 4_096;

/// Who asked. The node uses the kind for its verb allowlist and records the id
/// in audit; it never derives authority from the id itself.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Principal {
    pub kind: PrincipalKind,
    pub id: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PrincipalKind {
    /// A signed-in user acting through the control plane.
    User,
    /// A constrained service principal (for example a delegated backup).
    Service,
    /// The control plane's own reconcilers and schedulers.
    System,
    /// An install administrator after step-up.
    InstallAdmin,
    /// The scoped platform reconciler (firewall, proxy, platform update).
    Platform,
}

/// Permission bits a capability carries. A verb lists the bits it needs
/// ([`Verb::required`]); the capability must carry all of them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Permission {
    Read,
    Mutate,
    /// Node → CP bulk stream.
    StreamOut,
    /// CP → node bulk stream.
    StreamIn,
    /// PTY or stdin to a process.
    Interactive,
    /// Install-admin-only surfaces (host shell, unmanaged inventory, enrollment).
    InstallAdmin,
    /// Platform reconciler surfaces (firewall, proxy, platform update).
    Platform,
}

impl Permission {
    pub const ALL: [Self; 7] = [
        Self::Read,
        Self::Mutate,
        Self::StreamOut,
        Self::StreamIn,
        Self::Interactive,
        Self::InstallAdmin,
        Self::Platform,
    ];
}

macro_rules! verbs {
    ($( $(#[$meta:meta])* $variant:ident = $name:literal => [$($perm:ident),*] $(, monitor = $mon:literal)? ;)*) => {
        /// Every node verb. The name is frozen; argument
        /// schemas live in [`crate::command`].
        #[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        pub enum Verb {
            $( $(#[$meta])* #[serde(rename = $name)] $variant, )*
        }

        impl Verb {
            pub const ALL: &'static [Self] = &[$(Self::$variant),*];

            #[must_use]
            pub const fn as_str(self) -> &'static str {
                match self { $(Self::$variant => $name),* }
            }

            /// Permissions a capability must carry for this verb.
            #[must_use]
            pub const fn required(self) -> &'static [Permission] {
                match self { $(Self::$variant => &[$(Permission::$perm),*]),* }
            }

            /// Whether a monitor-role node accepts this verb.
            #[must_use]
            pub const fn allowed_on_monitor(self) -> bool {
                match self { $(Self::$variant => verbs!(@mon $($mon)?)),* }
            }
        }
    };
    (@mon) => { false };
    (@mon $mon:literal) => { $mon };
}

verbs! {
    // Lifecycle. Grant-bound; the same barrier for every path.
    /// Install a slot grant and start its first attempt.
    WorkloadApply = "workload.apply" => [Mutate];
    /// Start a new attempt under an active grant (operator restart).
    WorkloadRestart = "workload.restart" => [Mutate];
    /// Revoke start authority and produce a positive stop certificate.
    WorkloadStop = "workload.stop" => [Mutate];
    /// Remove stopped attempts and release their holds and claims.
    WorkloadRemove = "workload.remove" => [Mutate];
    /// Release an adopted container without stopping it (migration rollback).
    WorkloadReleaseAdoption = "workload.release-adoption" => [Mutate];
    WorkloadInspect = "workload.inspect" => [Read];
    WorkloadLogs = "workload.logs" => [Read, StreamOut];
    /// Run one job attempt under a run grant.
    JobRun = "job.run" => [Mutate];
    /// Query the recorded state of an operation (an expired retry never re-executes).
    OpStatus = "op.status" => [Read], monitor = true;

    // Node.
    NodeDetails = "node.details" => [Read], monitor = true;
    NodeHealth = "node.health" => [Read], monitor = true;
    NodeUnits = "node.units" => [Read];
    NodeReclaim = "node.reclaim" => [Mutate, InstallAdmin];
    NodeUpgrade = "node.upgrade" => [Platform], monitor = true;
    NodeDecommission = "node.decommission" => [Mutate, InstallAdmin], monitor = true;
    /// Re-enrollment with a new node epoch after a fence or journal loss.
    NodeReenroll = "node.reenroll" => [InstallAdmin], monitor = true;
    /// Retire every earlier Engine submission using external barrier evidence.
    NodeRetireByBarrier = "node.retireByBarrier" => [Mutate, InstallAdmin];
    MetricsSample = "metrics.sample" => [Read], monitor = true;
    EventsSubscribe = "events.subscribe" => [Read, StreamOut];
    /// Push the check definitions this node executes.
    HealthConfigure = "health.configure" => [Mutate], monitor = true;

    // Containers.
    ContainerList = "container.list" => [Read];
    ContainerInspect = "container.inspect" => [Read];
    ContainerLogs = "container.logs" => [Read, StreamOut];
    ContainerExec = "container.exec" => [Interactive];

    // Images.
    ImagePull = "image.pull" => [Mutate];
    ImagePush = "image.push" => [Mutate];
    ImageInspect = "image.inspect" => [Read];
    ImageList = "image.list" => [Read];
    ImageRemove = "image.remove" => [Mutate];
    ImagePrune = "image.prune" => [Mutate];

    // Networks.
    NetworkList = "network.list" => [Read];
    NetworkInspect = "network.inspect" => [Read];
    NetworkEnsure = "network.ensure" => [Mutate];
    NetworkConnect = "network.connect" => [Mutate];
    NetworkDisconnect = "network.disconnect" => [Mutate];
    NetworkRemove = "network.remove" => [Mutate];

    // Volumes and storage.
    VolumeList = "volume.list" => [Read];
    VolumeInspect = "volume.inspect" => [Read];
    VolumeCreate = "volume.create" => [Mutate];
    VolumeRemove = "volume.remove" => [Mutate];
    VolumeFs = "volume.fs" => [Read];
    VolumeExport = "volume.export" => [Read, StreamOut];
    VolumeImport = "volume.import" => [Mutate, StreamIn];
    VolumeSnapshot = "volume.snapshot" => [Mutate];
    VolumeClone = "volume.clone" => [Mutate];
    PoolStats = "pool.stats" => [Read];
    PoolTrim = "pool.trim" => [Mutate];
    PoolGrow = "pool.grow" => [Mutate, InstallAdmin];

    // Backups.
    BackupRun = "backup.run" => [Mutate];
    BackupRestore = "backup.restore" => [Mutate];
    BackupStatus = "backup.status" => [Read];

    // Interactive.
    DbConnect = "db.connect" => [Interactive];
    HostShell = "host.shell" => [Interactive, InstallAdmin];

    // Platform reconcilers.
    FirewallApply = "firewall.apply" => [Platform];
    FirewallCscli = "firewall.cscli" => [Platform, InstallAdmin];
    ProxyApply = "proxy.apply" => [Platform];
    ProxyStatus = "proxy.status" => [Read];
    PlatformUpdate = "platform.update" => [Platform, InstallAdmin];
}

impl std::fmt::Display for Verb {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Binds a capability to an exact grant / attempt, so a capability for one
/// generation can never act on another (attempt-bound authorization).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttemptBinding {
    pub slot: SlotRef,
    pub grant_id: GrantId,
    pub generation: U53,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<AttemptId>,
}

/// The signed authorization for one request (payload of a
/// [`crate::envelope::SignContext::Capability`] envelope).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Capability {
    pub install_id: InstallId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub org_id: Option<OrgId>,
    pub principal: Principal,
    /// Audience: the only node that may act on this capability.
    pub aud: NodeId,
    pub node_epoch: U53,
    pub authority_term: U53,
    pub verb: Verb,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource_id: Option<ResourceId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub binding: Option<AttemptBinding>,
    /// Filesystem root the request may touch (volume/archive verbs).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path_root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volume: Option<String>,
    /// Durable, monotonic per-resource operation epoch.
    pub operation_epoch: U53,
    pub op_id: OpId,
    /// SHA-256 of the exact command payload bytes.
    pub payload_hash: Sha256Hex,
    pub nonce: Nonce,
    pub session_id: SessionId,
    pub not_before_unix_ms: UnixMs,
    pub expires_at_unix_ms: UnixMs,
    /// Upper bound for any stream or archive the request opens.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_bytes: Option<U53>,
    pub permissions: Vec<Permission>,
}

/// What the node knows about its session when it checks a capability.
#[derive(Clone, Debug)]
pub struct CheckContext<'a> {
    pub install_id: &'a InstallId,
    pub node_id: &'a NodeId,
    pub node_epoch: U53,
    pub session_id: &'a SessionId,
    /// Term announced by the control plane for this session.
    pub authority_term: U53,
    /// Every term below this was revoked by the recovery root.
    pub revoked_below_term: U53,
    /// `None` when time validity cannot be established: new privileged
    /// operations are then refused.
    pub clock: Option<ClockBound>,
    /// Highest operation epoch the journal recorded for the capability's resource.
    pub operation_epoch_high_water: U53,
    /// This node runs only the monitor role.
    pub monitor_only: bool,
}

/// A wall-clock reading with its bounded uncertainty.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ClockBound {
    pub now_unix_ms: UnixMs,
    pub uncertainty_ms: DurationMs,
}

/// Why a capability was refused. Refusal happens before the `opId` claim, so a
/// refused request has no side effect and no journal record.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "kebab-case")]
pub enum CapabilityError {
    #[error("capability is for another install")]
    WrongInstall,
    #[error("capability is addressed to another node")]
    WrongAudience,
    #[error("capability names node epoch {got}, current is {current}")]
    StaleNodeEpoch { got: U53, current: U53 },
    #[error("capability is bound to another session")]
    WrongSession,
    #[error("capability names authority term {got}, session term is {current}")]
    WrongTerm { got: U53, current: U53 },
    #[error("authority term {got} was revoked (everything below {below})")]
    RevokedTerm { got: U53, below: U53 },
    #[error("time validity cannot be established")]
    ClockUnknown,
    #[error("clock uncertainty {uncertainty_ms} ms exceeds the bound")]
    #[serde(rename_all = "camelCase")]
    ClockTooUncertain { uncertainty_ms: U53 },
    #[error("validity window of {ttl_ms} ms is empty or exceeds the maximum")]
    #[serde(rename_all = "camelCase")]
    BadValidityWindow { ttl_ms: U53 },
    #[error("capability is not yet valid")]
    NotYetValid,
    #[error("capability expired")]
    Expired,
    #[error("payload hash does not match the capability")]
    PayloadMismatch,
    #[error("verb {verb} needs permission {missing:?}")]
    MissingPermission { verb: Verb, missing: Permission },
    #[error("verb {verb} is not accepted by a monitor node")]
    NotOnMonitor { verb: Verb },
    #[error("operation epoch {got} is older than {high_water}")]
    #[serde(rename_all = "camelCase")]
    StaleOperationEpoch { got: U53, high_water: U53 },
    #[error("nonce already used")]
    Replayed,
    #[error("too many outstanding nonces; retry later")]
    NonceCacheFull,
}

impl Capability {
    /// Every stateless check, in a fixed order. Replay of the nonce is checked
    /// separately by [`ReplayGuard::admit`], after this succeeds.
    pub fn check(&self, ctx: &CheckContext<'_>, payload: &[u8]) -> Result<(), CapabilityError> {
        if &self.install_id != ctx.install_id {
            return Err(CapabilityError::WrongInstall);
        }
        if &self.aud != ctx.node_id {
            return Err(CapabilityError::WrongAudience);
        }
        if self.node_epoch != ctx.node_epoch {
            return Err(CapabilityError::StaleNodeEpoch {
                got: self.node_epoch,
                current: ctx.node_epoch,
            });
        }
        if &self.session_id != ctx.session_id {
            return Err(CapabilityError::WrongSession);
        }
        if self.authority_term < ctx.revoked_below_term {
            return Err(CapabilityError::RevokedTerm {
                got: self.authority_term,
                below: ctx.revoked_below_term,
            });
        }
        if self.authority_term != ctx.authority_term {
            return Err(CapabilityError::WrongTerm {
                got: self.authority_term,
                current: ctx.authority_term,
            });
        }
        self.check_time(ctx.clock)?;
        if Sha256Hex::digest(payload) != self.payload_hash {
            return Err(CapabilityError::PayloadMismatch);
        }
        if let Some(missing) = self
            .verb
            .required()
            .iter()
            .find(|p| !self.permissions.contains(p))
        {
            return Err(CapabilityError::MissingPermission {
                verb: self.verb,
                missing: *missing,
            });
        }
        if ctx.monitor_only && !self.verb.allowed_on_monitor() {
            return Err(CapabilityError::NotOnMonitor { verb: self.verb });
        }
        if self.operation_epoch < ctx.operation_epoch_high_water {
            return Err(CapabilityError::StaleOperationEpoch {
                got: self.operation_epoch,
                high_water: ctx.operation_epoch_high_water,
            });
        }
        Ok(())
    }

    fn check_time(&self, clock: Option<ClockBound>) -> Result<(), CapabilityError> {
        let clock = clock.ok_or(CapabilityError::ClockUnknown)?;
        if clock.uncertainty_ms.get() > MAX_CLOCK_UNCERTAINTY_MS {
            return Err(CapabilityError::ClockTooUncertain {
                uncertainty_ms: clock.uncertainty_ms,
            });
        }
        let ttl = self
            .expires_at_unix_ms
            .get()
            .saturating_sub(self.not_before_unix_ms.get());
        if ttl > MAX_CAPABILITY_TTL_MS || self.expires_at_unix_ms <= self.not_before_unix_ms {
            return Err(CapabilityError::BadValidityWindow {
                ttl_ms: U53::from_const(ttl),
            });
        }
        // The true time lies in [now − u, now + u]. Accept only if the whole
        // interval is before expiry; tolerate a node clock running behind for
        // not-before, which only orders issuance.
        let latest = clock.now_unix_ms.saturating_add(clock.uncertainty_ms.get());
        if latest >= self.expires_at_unix_ms {
            return Err(CapabilityError::Expired);
        }
        if latest < self.not_before_unix_ms {
            return Err(CapabilityError::NotYetValid);
        }
        Ok(())
    }
}

/// Session-scoped single-use nonce memory. Entries are kept until their
/// capability has certainly expired (expiry + clock uncertainty). A new session
/// starts empty: capabilities are bound to their session id, so a capability
/// from an earlier session already fails [`Capability::check`].
#[derive(Debug, Default)]
pub struct ReplayGuard {
    /// nonce → forget-after instant.
    seen: BTreeMap<Nonce, U53>,
}

impl ReplayGuard {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Admit a nonce once. Call only after [`Capability::check`] succeeded.
    pub fn admit(
        &mut self,
        capability: &Capability,
        clock: ClockBound,
    ) -> Result<(), CapabilityError> {
        let lowest = clock.now_unix_ms.saturating_sub(clock.uncertainty_ms.get());
        self.seen.retain(|_, forget_after| *forget_after >= lowest);
        if self.seen.contains_key(&capability.nonce) {
            return Err(CapabilityError::Replayed);
        }
        if self.seen.len() >= NONCE_CACHE_CAPACITY {
            return Err(CapabilityError::NonceCacheFull);
        }
        let forget_after = capability
            .expires_at_unix_ms
            .saturating_add(clock.uncertainty_ms.get());
        self.seen.insert(capability.nonce.clone(), forget_after);
        Ok(())
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.seen.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.seen.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id<T: std::str::FromStr>(s: &str) -> T
    where
        T::Err: std::fmt::Debug,
    {
        s.parse().unwrap()
    }

    fn cap(payload: &[u8]) -> Capability {
        Capability {
            install_id: id("inst-1"),
            org_id: Some(id("org-1")),
            principal: Principal {
                kind: PrincipalKind::System,
                id: "scheduler".into(),
            },
            aud: id("node-1"),
            node_epoch: U53::from_const(3),
            authority_term: U53::from_const(2),
            verb: Verb::WorkloadApply,
            resource_id: Some(id("svc-1")),
            binding: None,
            path_root: None,
            volume: None,
            operation_epoch: U53::from_const(7),
            op_id: id("op-1"),
            payload_hash: Sha256Hex::digest(payload),
            nonce: Nonce::new("ab".repeat(32)).unwrap(),
            session_id: id("sess-1"),
            not_before_unix_ms: U53::from_const(1_000_000),
            expires_at_unix_ms: U53::from_const(1_030_000),
            max_bytes: None,
            permissions: vec![Permission::Mutate],
        }
    }

    struct Ctx {
        install: InstallId,
        node: NodeId,
        session: SessionId,
    }

    impl Ctx {
        fn new() -> Self {
            Self {
                install: id("inst-1"),
                node: id("node-1"),
                session: id("sess-1"),
            }
        }

        fn at(&self, now: u64) -> CheckContext<'_> {
            CheckContext {
                install_id: &self.install,
                node_id: &self.node,
                node_epoch: U53::from_const(3),
                session_id: &self.session,
                authority_term: U53::from_const(2),
                revoked_below_term: U53::from_const(1),
                clock: Some(ClockBound {
                    now_unix_ms: U53::from_const(now),
                    uncertainty_ms: U53::from_const(500),
                }),
                operation_epoch_high_water: U53::from_const(7),
                monitor_only: false,
            }
        }
    }

    #[test]
    fn accepts_a_matching_capability() {
        let c = cap(b"{}");
        assert_eq!(c.check(&Ctx::new().at(1_010_000), b"{}"), Ok(()));
    }

    #[test]
    fn binds_install_audience_epoch_session_and_term() {
        let ctx = Ctx::new();
        let mut c = cap(b"{}");
        c.aud = id("node-2");
        assert_eq!(
            c.check(&ctx.at(1_010_000), b"{}"),
            Err(CapabilityError::WrongAudience)
        );
        let mut c = cap(b"{}");
        c.node_epoch = U53::from_const(2);
        assert!(matches!(
            c.check(&ctx.at(1_010_000), b"{}"),
            Err(CapabilityError::StaleNodeEpoch { .. })
        ));
        let mut c = cap(b"{}");
        c.session_id = id("sess-0");
        assert_eq!(
            c.check(&ctx.at(1_010_000), b"{}"),
            Err(CapabilityError::WrongSession)
        );
        let mut c = cap(b"{}");
        c.authority_term = U53::ZERO;
        assert!(matches!(
            c.check(&ctx.at(1_010_000), b"{}"),
            Err(CapabilityError::RevokedTerm { .. })
        ));
        let mut c = cap(b"{}");
        c.authority_term = U53::from_const(3);
        assert!(matches!(
            c.check(&ctx.at(1_010_000), b"{}"),
            Err(CapabilityError::WrongTerm { .. })
        ));
    }

    #[test]
    fn time_is_conservative_under_uncertainty() {
        let ctx = Ctx::new();
        let c = cap(b"{}");
        // now + u = expiry: refused.
        assert_eq!(
            c.check(&ctx.at(1_029_500), b"{}"),
            Err(CapabilityError::Expired)
        );
        assert_eq!(c.check(&ctx.at(1_029_499), b"{}"), Ok(()));
        // A node clock up to u behind still accepts a just-issued capability.
        assert_eq!(c.check(&ctx.at(999_500), b"{}"), Ok(()));
        assert_eq!(
            c.check(&ctx.at(999_499), b"{}"),
            Err(CapabilityError::NotYetValid)
        );
        let mut unknown = ctx.at(1_010_000);
        unknown.clock = None;
        assert_eq!(c.check(&unknown, b"{}"), Err(CapabilityError::ClockUnknown));
        let mut long = cap(b"{}");
        long.expires_at_unix_ms = U53::from_const(1_000_000 + MAX_CAPABILITY_TTL_MS + 1);
        assert!(matches!(
            long.check(&ctx.at(1_010_000), b"{}"),
            Err(CapabilityError::BadValidityWindow { .. })
        ));
    }

    #[test]
    fn payload_permissions_monitor_and_epoch() {
        let ctx = Ctx::new();
        let c = cap(b"{}");
        assert_eq!(
            c.check(&ctx.at(1_010_000), b"{ }"),
            Err(CapabilityError::PayloadMismatch)
        );
        let mut c = cap(b"{}");
        c.permissions = vec![Permission::Read];
        assert!(matches!(
            c.check(&ctx.at(1_010_000), b"{}"),
            Err(CapabilityError::MissingPermission { .. })
        ));
        let mut monitor = ctx.at(1_010_000);
        monitor.monitor_only = true;
        assert!(matches!(
            cap(b"{}").check(&monitor, b"{}"),
            Err(CapabilityError::NotOnMonitor { .. })
        ));
        let mut c = cap(b"{}");
        c.operation_epoch = U53::from_const(6);
        assert!(matches!(
            c.check(&ctx.at(1_010_000), b"{}"),
            Err(CapabilityError::StaleOperationEpoch { .. })
        ));
    }

    #[test]
    fn replay_guard_admits_once_and_forgets_after_expiry() {
        let c = cap(b"{}");
        let mut g = ReplayGuard::new();
        let clock = |now| ClockBound {
            now_unix_ms: U53::from_const(now),
            uncertainty_ms: U53::from_const(500),
        };
        assert_eq!(g.admit(&c, clock(1_010_000)), Ok(()));
        assert_eq!(
            g.admit(&c, clock(1_020_000)),
            Err(CapabilityError::Replayed)
        );
        // Remembered until expiry + 2u has certainly passed on the lower bound.
        assert_eq!(
            g.admit(&c, clock(1_031_000)),
            Err(CapabilityError::Replayed)
        );
        assert_eq!(g.admit(&c, clock(1_031_001)), Ok(()));
    }

    #[test]
    fn replay_guard_fails_closed_when_full() {
        let mut g = ReplayGuard::new();
        let clock = ClockBound {
            now_unix_ms: U53::from_const(1_010_000),
            uncertainty_ms: U53::ZERO,
        };
        for i in 0..NONCE_CACHE_CAPACITY {
            let mut c = cap(b"{}");
            c.nonce = Nonce::new(format!("{i:064x}")).unwrap();
            assert_eq!(g.admit(&c, clock), Ok(()));
        }
        let mut c = cap(b"{}");
        c.nonce = Nonce::new("f".repeat(64)).unwrap();
        assert_eq!(g.admit(&c, clock), Err(CapabilityError::NonceCacheFull));
    }

    #[test]
    fn verb_names_are_unique_and_dotted() {
        let mut names: Vec<&str> = Verb::ALL.iter().map(|v| v.as_str()).collect();
        let total = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), total);
        for v in Verb::ALL {
            assert!(v.as_str().contains('.'));
            assert!(!v.required().is_empty());
            let json = serde_json::to_string(v).unwrap();
            assert_eq!(serde_json::from_str::<Verb>(&json).unwrap(), *v);
        }
    }
}
