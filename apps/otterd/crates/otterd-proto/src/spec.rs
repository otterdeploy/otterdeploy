//! ServiceSpec: Swarm ServiceSpec semantics with otterd's defaults (PLAN §4,
//! MODEL §2.1).
//!
//! Two shapes: [`ServiceSpecInput`] is what the API, manifest and Compose
//! normalization produce (lifecycle and update order may be left out), and
//! [`ServiceSpec`] is the fully explicit form the control plane stores and sends
//! to nodes. [`ServiceSpecInput::normalize`] is the only place defaults are
//! chosen, and the TypeScript mirror implements the same function against the
//! same fixtures. [`ServiceSpec::validate`] never rewrites a choice: a requested
//! start-first on an exclusive service is an error, not a silent stop-first.

use crate::identity::NodeRole;
use crate::ids::{CheckId, ConcurrencyGroup, DataIdentity, NodeId, ResourceId, ScopeId};
use crate::num::{DurationMs, U53};
use crate::version::SERVICE_SPEC_SCHEMA;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// Default per-service failover delay (PLAN §4).
pub const DEFAULT_FAILOVER_DELAY_MS: u64 = 60_000;
/// Smallest failover delay a service may configure.
pub const MIN_FAILOVER_DELAY_MS: u64 = 30_000;
/// Admission default when a workload declares no memory reservation (PLAN §6.4).
pub const DEFAULT_MEMORY_RESERVATION_BYTES: u64 = 64 * 1024 * 1024;
/// Admission default when a workload declares no CPU reservation: 0.05 CPU.
pub const DEFAULT_NANO_CPU_RESERVATION: u64 = 50_000_000;
/// Default stop grace before SIGKILL (MODEL §3).
pub const DEFAULT_STOP_GRACE_MS: u64 = 10_000;

// serde's `skip_serializing_if` passes a reference.
#[allow(clippy::trivially_copy_pass_by_ref)]
fn is_false(v: &bool) -> bool {
    !*v
}

/// How many tasks exist and where.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ServiceMode {
    /// `replicas` slots placed by the scheduler.
    Replicated { replicas: u32 },
    /// One slot per eligible active node; a missing node is never replaced by a
    /// second slot elsewhere.
    Global,
    /// Durable runs with attempts (MODEL §2.5).
    #[serde(rename_all = "camelCase")]
    Job {
        /// Attempts that may run at once for one run.
        max_concurrent: u32,
        /// Successful completions that finish a run.
        completions: u32,
    },
}

impl Default for ServiceMode {
    fn default() -> Self {
        Self::Replicated { replicas: 1 }
    }
}

impl ServiceMode {
    /// More than one task may share a writable mount.
    fn may_run_many(&self) -> bool {
        match self {
            Self::Replicated { replicas } => *replicas > 1,
            Self::Global => true,
            Self::Job { max_concurrent, .. } => *max_concurrent > 1,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageSpec {
    /// Human reference (`registry/repo:tag`), informational once `digest` is set.
    pub reference: String,
    /// Content digest `sha256:<64 hex>`; the only thing a node will run when set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum EnvValue {
    Literal {
        value: String,
    },
    /// Resolved on the node from the encrypted secret store; never logged.
    #[serde(rename_all = "camelCase")]
    Secret {
        secret_ref: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnvVar {
    pub name: String,
    pub value: EnvValue,
}

/// Whether the image's own HEALTHCHECK stays effective (MONITORING §5).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ImageHealthcheck {
    #[default]
    Inherit,
    Disable,
}

/// A health check this service's tasks are gated on, by exact revision.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CheckRef {
    pub id: CheckId,
    pub revision: U53,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContainerSpec {
    pub image: ImageSpec,
    /// Entrypoint override.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub env: Vec<EnvVar>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workdir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hostname: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub labels: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub init: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub tty: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub read_only_rootfs: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop_signal: Option<String>,
    #[serde(default = "default_stop_grace")]
    pub stop_grace_ms: DurationMs,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cap_add: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cap_drop: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub sysctls: BTreeMap<String, String>,
    #[serde(default)]
    pub image_healthcheck: ImageHealthcheck,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub checks: Vec<CheckRef>,
}

fn default_stop_grace() -> DurationMs {
    U53::from_const(DEFAULT_STOP_GRACE_MS)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MountKind {
    Volume,
    Bind,
    Tmpfs,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Mount {
    pub kind: MountKind,
    /// Volume name or host path; absent for tmpfs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    pub target: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub read_only: bool,
    /// Normalized on the owning host before admission (MODEL §2.6); when set,
    /// the node stages the retained object instead of passing `source` to Docker.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_identity: Option<DataIdentity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tmpfs_size_bytes: Option<U53>,
}

impl Mount {
    /// Persistent data (volume or bind); tmpfs is not data.
    #[must_use]
    pub fn is_data(&self) -> bool {
        matches!(self.kind, MountKind::Volume | MountKind::Bind)
    }

    #[must_use]
    pub fn is_writable_data(&self) -> bool {
        self.is_data() && !self.read_only
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceLimits {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nano_cpus: Option<U53>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory_bytes: Option<U53>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pids: Option<u32>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceReservations {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nano_cpus: Option<U53>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory_bytes: Option<U53>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Resources {
    #[serde(default)]
    pub limits: ResourceLimits,
    #[serde(default)]
    pub reservations: ResourceReservations,
    /// Reservations the normalizer filled with admission defaults, shown in the UI
    /// (a default is not a guarantee against OOM).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub defaulted: Vec<ReservationKind>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReservationKind {
    Cpu,
    Memory,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RestartCondition {
    #[default]
    Any,
    OnFailure,
    None,
}

/// Owned by the node supervisor; Docker's restart policy is `no` (MODEL §2.4).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RestartPolicy {
    #[serde(default)]
    pub condition: RestartCondition,
    #[serde(default = "default_restart_delay")]
    pub delay_ms: DurationMs,
    /// `None` = unlimited.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_attempts: Option<u32>,
    /// Window over which `max_attempts` counts; zero = unbounded.
    #[serde(default)]
    pub window_ms: DurationMs,
}

fn default_restart_delay() -> DurationMs {
    U53::from_const(5_000)
}

impl Default for RestartPolicy {
    fn default() -> Self {
        Self {
            condition: RestartCondition::Any,
            delay_ms: default_restart_delay(),
            max_attempts: None,
            window_ms: U53::ZERO,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConstraintOp {
    Eq,
    Neq,
}

/// A hard constraint on a node label or attribute. Never silently relaxed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Constraint {
    pub key: String,
    pub op: ConstraintOp,
    pub value: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpreadPreference {
    pub label: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Placement {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub constraints: Vec<Constraint>,
    /// Allowed CPU architectures (`amd64`, `arm64`); empty = any.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub architectures: Vec<String>,
    /// Required node roles; empty = `worker`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub roles: Vec<NodeRole>,
    /// Explicit node allowlist (the existing placement pin); empty = any.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nodes: Vec<NodeId>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub preferences: Vec<SpreadPreference>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_replicas_per_node: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskSpec {
    pub container: ContainerSpec,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mounts: Vec<Mount>,
    #[serde(default)]
    pub resources: Resources,
    #[serde(default)]
    pub restart: RestartPolicy,
    #[serde(default)]
    pub placement: Placement,
}

impl TaskSpec {
    #[must_use]
    pub fn has_data(&self) -> bool {
        self.mounts.iter().any(Mount::is_data)
    }

    #[must_use]
    pub fn has_writable_data(&self) -> bool {
        self.mounts.iter().any(Mount::is_writable_data)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FailureAction {
    Pause,
    Continue,
    Rollback,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateOrder {
    StopFirst,
    StartFirst,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateConfig {
    /// Slots per batch; zero = all at once.
    pub parallelism: u32,
    pub delay_ms: DurationMs,
    pub monitor_ms: DurationMs,
    /// Failed fraction tolerated, in thousandths (0..=1000).
    pub max_failure_ratio_permille: u16,
    pub failure_action: FailureAction,
    pub order: UpdateOrder,
}

/// Partial update config as entered.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateConfigInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parallelism: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delay_ms: Option<DurationMs>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub monitor_ms: Option<DurationMs>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_failure_ratio_permille: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_action: Option<FailureAction>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<UpdateOrder>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EndpointMode {
    /// Stable per-service VIP (default; the only mode in which a backend move is
    /// invisible to pinned and pooled clients).
    #[default]
    Vip,
    /// DNS round robin, opt-in with the PLAN §8.1 warning list.
    Dnsrr,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PortProtocol {
    #[default]
    Tcp,
    Udp,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PublishMode {
    /// Reachable through the VIP and the edge only.
    #[default]
    Internal,
    /// Bound on the host of each task (a fixed host port).
    Host,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortSpec {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default)]
    pub protocol: PortProtocol,
    pub target_port: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published_port: Option<u16>,
    #[serde(default)]
    pub publish: PublishMode,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EndpointSpec {
    #[serde(default)]
    pub mode: EndpointMode,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ports: Vec<PortSpec>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scopes: Vec<ScopeId>,
}

impl EndpointSpec {
    #[must_use]
    pub fn has_host_ports(&self) -> bool {
        self.ports
            .iter()
            .any(|p| p.publish == PublishMode::Host && p.published_port.is_some())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FailoverPolicy {
    /// Never moved automatically (data-owning default).
    Stay,
    /// Rescheduled to an eligible node after the delay and evidence checks.
    Reschedule,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Failover {
    pub policy: FailoverPolicy,
    /// Measured from the last qualifying node evidence; a longer delay always wins.
    pub delay_ms: DurationMs,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DisconnectAction {
    /// Keep the current process under its durable grant; no new exclusive attempt.
    ContinueExisting,
    /// Stop on lease expiry while able to execute.
    Stop,
}

/// Explicit authorization for several writers on one data identity (MODEL §2.6).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConcurrentSafe {
    pub revision: U53,
    pub justification: String,
}

/// Which default rule produced the lifecycle.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LifecycleBasis {
    /// Database or any volume/bind-mounted service: stay + exclusive.
    Mounted,
    /// No data mounts: reschedule + overlap-tolerant.
    MountFree,
    /// Job, cron or hook: exclusive per run.
    Job,
}

/// A lifecycle field that the operator set explicitly, overriding the default.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LifecycleField {
    FailoverPolicy,
    FailoverDelay,
    Exclusive,
    DisconnectAction,
    UpdateOrder,
    RollbackOrder,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Lifecycle {
    pub failover: Failover,
    /// No overlapping generations per slot (MODEL §2.1).
    pub exclusive: bool,
    pub disconnect_action: DisconnectAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub concurrency_group: Option<ConcurrencyGroup>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub concurrent_safe: Option<ConcurrentSafe>,
    pub basis: LifecycleBasis,
    /// Fields that differ from the basis default because they were set explicitly.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub overrides: Vec<LifecycleField>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LifecycleInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failover_policy: Option<FailoverPolicy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failover_delay_ms: Option<DurationMs>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exclusive: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disconnect_action: Option<DisconnectAction>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub concurrency_group: Option<ConcurrencyGroup>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub concurrent_safe: Option<ConcurrentSafe>,
}

/// The normalized, fully explicit service specification.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServiceSpec {
    pub schema: u16,
    pub resource_id: ResourceId,
    pub mode: ServiceMode,
    pub task: TaskSpec,
    pub update: UpdateConfig,
    pub rollback: UpdateConfig,
    pub endpoint: EndpointSpec,
    pub lifecycle: Lifecycle,
}

/// A service specification as entered; [`Self::normalize`] fills the defaults.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServiceSpecInput {
    pub resource_id: ResourceId,
    #[serde(default)]
    pub mode: ServiceMode,
    pub task: TaskSpec,
    #[serde(default)]
    pub update: UpdateConfigInput,
    #[serde(default)]
    pub rollback: UpdateConfigInput,
    #[serde(default)]
    pub endpoint: EndpointSpec,
    #[serde(default)]
    pub lifecycle: LifecycleInput,
}

impl ServiceSpecInput {
    /// Fill every default (PLAN §4 defaults table). Pure and deterministic.
    #[must_use]
    pub fn normalize(&self) -> ServiceSpec {
        let basis = if matches!(self.mode, ServiceMode::Job { .. }) {
            LifecycleBasis::Job
        } else if self.task.has_data() {
            LifecycleBasis::Mounted
        } else {
            LifecycleBasis::MountFree
        };
        let (policy, exclusive, disconnect) = match basis {
            LifecycleBasis::Mounted => (
                FailoverPolicy::Stay,
                true,
                DisconnectAction::ContinueExisting,
            ),
            LifecycleBasis::MountFree => {
                (FailoverPolicy::Reschedule, false, DisconnectAction::Stop)
            }
            LifecycleBasis::Job => (FailoverPolicy::Stay, true, DisconnectAction::Stop),
        };
        let li = &self.lifecycle;
        let exclusive_final = li.exclusive.unwrap_or(exclusive);
        let default_order = if exclusive_final || self.endpoint.has_host_ports() {
            UpdateOrder::StopFirst
        } else {
            UpdateOrder::StartFirst
        };

        let mut overrides = BTreeSet::new();
        let mut note = |field, set: bool| {
            if set {
                overrides.insert(field);
            }
        };
        note(
            LifecycleField::FailoverPolicy,
            li.failover_policy.is_some_and(|p| p != policy),
        );
        note(
            LifecycleField::FailoverDelay,
            li.failover_delay_ms
                .is_some_and(|d| d.get() != DEFAULT_FAILOVER_DELAY_MS),
        );
        note(
            LifecycleField::Exclusive,
            li.exclusive.is_some_and(|e| e != exclusive),
        );
        note(
            LifecycleField::DisconnectAction,
            li.disconnect_action.is_some_and(|d| d != disconnect),
        );
        note(
            LifecycleField::UpdateOrder,
            self.update.order.is_some_and(|o| o != default_order),
        );
        note(
            LifecycleField::RollbackOrder,
            self.rollback.order.is_some_and(|o| o != default_order),
        );

        let mut task = self.task.clone();
        let mut defaulted = BTreeSet::new();
        if task.resources.reservations.memory_bytes.is_none() {
            task.resources.reservations.memory_bytes =
                Some(U53::from_const(DEFAULT_MEMORY_RESERVATION_BYTES));
            defaulted.insert(ReservationKind::Memory);
        }
        if task.resources.reservations.nano_cpus.is_none() {
            task.resources.reservations.nano_cpus =
                Some(U53::from_const(DEFAULT_NANO_CPU_RESERVATION));
            defaulted.insert(ReservationKind::Cpu);
        }
        defaulted.extend(task.resources.defaulted.iter().copied());
        task.resources.defaulted = defaulted.into_iter().collect();

        ServiceSpec {
            schema: SERVICE_SPEC_SCHEMA,
            resource_id: self.resource_id.clone(),
            mode: self.mode.clone(),
            task,
            update: update_config(&self.update, default_order, FailureAction::Pause),
            rollback: update_config(&self.rollback, default_order, FailureAction::Pause),
            endpoint: self.endpoint.clone(),
            lifecycle: Lifecycle {
                failover: Failover {
                    policy: li.failover_policy.unwrap_or(policy),
                    delay_ms: li
                        .failover_delay_ms
                        .unwrap_or(U53::from_const(DEFAULT_FAILOVER_DELAY_MS)),
                },
                exclusive: exclusive_final,
                disconnect_action: li.disconnect_action.unwrap_or(disconnect),
                concurrency_group: li.concurrency_group.clone(),
                concurrent_safe: li.concurrent_safe.clone(),
                basis,
                overrides: overrides.into_iter().collect(),
            },
        }
    }
}

fn update_config(
    input: &UpdateConfigInput,
    default_order: UpdateOrder,
    default_action: FailureAction,
) -> UpdateConfig {
    UpdateConfig {
        parallelism: input.parallelism.unwrap_or(1),
        delay_ms: input.delay_ms.unwrap_or(U53::ZERO),
        monitor_ms: input.monitor_ms.unwrap_or(U53::from_const(5_000)),
        max_failure_ratio_permille: input.max_failure_ratio_permille.unwrap_or(0),
        failure_action: input.failure_action.unwrap_or(default_action),
        order: input.order.unwrap_or(default_order),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Severity {
    /// Admission refuses the spec.
    Error,
    /// Admitted; the UI shows the consequence.
    Warning,
}

/// Stable issue codes shared with the TypeScript validator and the UI.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SpecIssueCode {
    SchemaUnsupported,
    ExclusiveRequiresStopFirst,
    HostPortRequiresStopFirst,
    FailoverDelayBelowMinimum,
    SharedWritableMount,
    JobRequiresExclusive,
    MountSourceRequired,
    TmpfsHasSource,
    DuplicateMountTarget,
    FailureRatioOutOfRange,
    ImageDigestInvalid,
    RescheduleLeavesDataBehind,
    DnsrrClientLimitations,
}

impl SpecIssueCode {
    pub const ALL: [Self; 13] = [
        Self::SchemaUnsupported,
        Self::ExclusiveRequiresStopFirst,
        Self::HostPortRequiresStopFirst,
        Self::FailoverDelayBelowMinimum,
        Self::SharedWritableMount,
        Self::JobRequiresExclusive,
        Self::MountSourceRequired,
        Self::TmpfsHasSource,
        Self::DuplicateMountTarget,
        Self::FailureRatioOutOfRange,
        Self::ImageDigestInvalid,
        Self::RescheduleLeavesDataBehind,
        Self::DnsrrClientLimitations,
    ];
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpecIssue {
    pub code: SpecIssueCode,
    pub severity: Severity,
    /// JSON-pointer-like path of the offending field.
    pub path: String,
}

impl ServiceSpec {
    /// All issues, errors first, in a stable order.
    #[must_use]
    pub fn validate(&self) -> Vec<SpecIssue> {
        let mut out = Vec::new();
        let mut push = |code, severity, path: &str| {
            out.push(SpecIssue {
                code,
                severity,
                path: path.to_owned(),
            });
        };
        if self.schema != SERVICE_SPEC_SCHEMA {
            push(SpecIssueCode::SchemaUnsupported, Severity::Error, "/schema");
        }
        let lc = &self.lifecycle;
        for (cfg, path) in [(&self.update, "/update"), (&self.rollback, "/rollback")] {
            if cfg.order == UpdateOrder::StartFirst {
                if lc.exclusive {
                    push(
                        SpecIssueCode::ExclusiveRequiresStopFirst,
                        Severity::Error,
                        &format!("{path}/order"),
                    );
                }
                if self.endpoint.has_host_ports() {
                    push(
                        SpecIssueCode::HostPortRequiresStopFirst,
                        Severity::Error,
                        &format!("{path}/order"),
                    );
                }
            }
            if cfg.max_failure_ratio_permille > 1000 {
                push(
                    SpecIssueCode::FailureRatioOutOfRange,
                    Severity::Error,
                    &format!("{path}/maxFailureRatioPermille"),
                );
            }
        }
        if lc.failover.delay_ms.get() < MIN_FAILOVER_DELAY_MS {
            push(
                SpecIssueCode::FailoverDelayBelowMinimum,
                Severity::Error,
                "/lifecycle/failover/delayMs",
            );
        }
        if self.mode.may_run_many() && self.task.has_writable_data() && lc.concurrent_safe.is_none()
        {
            push(SpecIssueCode::SharedWritableMount, Severity::Error, "/mode");
        }
        if matches!(self.mode, ServiceMode::Job { .. }) && !lc.exclusive {
            push(
                SpecIssueCode::JobRequiresExclusive,
                Severity::Error,
                "/lifecycle/exclusive",
            );
        }
        self.validate_mounts(&mut push);
        if let Some(d) = &self.task.container.image.digest
            && !is_image_digest(d)
        {
            push(
                SpecIssueCode::ImageDigestInvalid,
                Severity::Error,
                "/task/container/image/digest",
            );
        }
        if lc.failover.policy == FailoverPolicy::Reschedule && self.task.has_writable_data() {
            push(
                SpecIssueCode::RescheduleLeavesDataBehind,
                Severity::Warning,
                "/lifecycle/failover/policy",
            );
        }
        if self.endpoint.mode == EndpointMode::Dnsrr {
            push(
                SpecIssueCode::DnsrrClientLimitations,
                Severity::Warning,
                "/endpoint/mode",
            );
        }
        out.sort_by_key(|i| (i.severity == Severity::Warning, i.code, i.path.clone()));
        out
    }

    fn validate_mounts(&self, push: &mut impl FnMut(SpecIssueCode, Severity, &str)) {
        let mut targets = BTreeSet::new();
        for (i, m) in self.task.mounts.iter().enumerate() {
            match (m.kind, &m.source) {
                (MountKind::Volume | MountKind::Bind, None) => push(
                    SpecIssueCode::MountSourceRequired,
                    Severity::Error,
                    &format!("/task/mounts/{i}/source"),
                ),
                (MountKind::Tmpfs, Some(_)) => push(
                    SpecIssueCode::TmpfsHasSource,
                    Severity::Error,
                    &format!("/task/mounts/{i}/source"),
                ),
                _ => {}
            }
            if !targets.insert(m.target.as_str()) {
                push(
                    SpecIssueCode::DuplicateMountTarget,
                    Severity::Error,
                    &format!("/task/mounts/{i}/target"),
                );
            }
        }
    }

    #[must_use]
    pub fn is_admissible(&self) -> bool {
        self.validate()
            .iter()
            .all(|i| i.severity != Severity::Error)
    }
}

/// `sha256:<64 lowercase hex>`.
#[must_use]
pub fn is_image_digest(d: &str) -> bool {
    d.strip_prefix("sha256:")
        .is_some_and(|h| h.len() == 64 && h.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(mounts: Vec<Mount>) -> ServiceSpecInput {
        ServiceSpecInput {
            resource_id: "svc".parse().unwrap(),
            mode: ServiceMode::default(),
            task: TaskSpec {
                container: serde_json::from_str(r#"{"image":{"reference":"nginx:1"}}"#).unwrap(),
                mounts,
                resources: Resources::default(),
                restart: RestartPolicy::default(),
                placement: Placement::default(),
            },
            update: UpdateConfigInput::default(),
            rollback: UpdateConfigInput::default(),
            endpoint: EndpointSpec::default(),
            lifecycle: LifecycleInput::default(),
        }
    }

    fn volume(read_only: bool) -> Mount {
        Mount {
            kind: MountKind::Volume,
            source: Some("pgdata".into()),
            target: "/var/lib/postgresql/data".into(),
            read_only,
            data_identity: None,
            tmpfs_size_bytes: None,
        }
    }

    #[test]
    fn mounted_services_stay_exclusive_stop_first() {
        let s = input(vec![volume(false)]).normalize();
        assert_eq!(s.lifecycle.basis, LifecycleBasis::Mounted);
        assert_eq!(s.lifecycle.failover.policy, FailoverPolicy::Stay);
        assert!(s.lifecycle.exclusive);
        assert_eq!(
            s.lifecycle.disconnect_action,
            DisconnectAction::ContinueExisting
        );
        assert_eq!(s.update.order, UpdateOrder::StopFirst);
        assert_eq!(
            s.lifecycle.failover.delay_ms.get(),
            DEFAULT_FAILOVER_DELAY_MS
        );
        assert!(s.is_admissible());
    }

    #[test]
    fn mount_free_services_reschedule_start_first_unless_host_ports() {
        let s = input(vec![]).normalize();
        assert_eq!(s.lifecycle.basis, LifecycleBasis::MountFree);
        assert_eq!(s.lifecycle.failover.policy, FailoverPolicy::Reschedule);
        assert!(!s.lifecycle.exclusive);
        assert_eq!(s.lifecycle.disconnect_action, DisconnectAction::Stop);
        assert_eq!(s.update.order, UpdateOrder::StartFirst);
        let mut i = input(vec![]);
        i.endpoint.ports.push(PortSpec {
            name: None,
            protocol: PortProtocol::Tcp,
            target_port: 80,
            published_port: Some(8080),
            publish: PublishMode::Host,
        });
        assert_eq!(i.normalize().update.order, UpdateOrder::StopFirst);
    }

    #[test]
    fn explicit_start_first_on_exclusive_is_an_error_not_rewritten() {
        let mut i = input(vec![volume(false)]);
        i.update.order = Some(UpdateOrder::StartFirst);
        let s = i.normalize();
        assert_eq!(s.update.order, UpdateOrder::StartFirst);
        assert_eq!(s.lifecycle.overrides, vec![LifecycleField::UpdateOrder]);
        let codes: Vec<_> = s.validate().into_iter().map(|i| i.code).collect();
        assert_eq!(codes, vec![SpecIssueCode::ExclusiveRequiresStopFirst]);
    }

    #[test]
    fn replicas_sharing_a_writable_root_need_concurrent_safe() {
        let mut i = input(vec![volume(false)]);
        i.mode = ServiceMode::Replicated { replicas: 2 };
        assert!(!i.normalize().is_admissible());
        i.lifecycle.concurrent_safe = Some(ConcurrentSafe {
            revision: U53::ONE,
            justification: "app-level fencing".into(),
        });
        assert!(i.normalize().is_admissible());
        // Read-only sharing is allowed.
        let mut ro = input(vec![volume(true)]);
        ro.mode = ServiceMode::Replicated { replicas: 3 };
        assert!(ro.normalize().is_admissible());
    }

    #[test]
    fn failover_minimum_and_reservation_defaults() {
        let mut i = input(vec![]);
        i.lifecycle.failover_delay_ms = Some(U53::from_const(29_999));
        let s = i.normalize();
        assert!(
            s.validate()
                .iter()
                .any(|x| x.code == SpecIssueCode::FailoverDelayBelowMinimum)
        );
        assert_eq!(
            s.task.resources.defaulted,
            vec![ReservationKind::Cpu, ReservationKind::Memory]
        );
        assert_eq!(
            s.task.resources.reservations.memory_bytes.map(U53::get),
            Some(DEFAULT_MEMORY_RESERVATION_BYTES)
        );
    }

    #[test]
    fn jobs_are_exclusive_per_run() {
        let mut i = input(vec![]);
        i.mode = ServiceMode::Job {
            max_concurrent: 1,
            completions: 1,
        };
        let s = i.normalize();
        assert_eq!(s.lifecycle.basis, LifecycleBasis::Job);
        assert!(s.lifecycle.exclusive);
        i.lifecycle.exclusive = Some(false);
        let codes: Vec<_> = i
            .normalize()
            .validate()
            .into_iter()
            .map(|x| x.code)
            .collect();
        assert!(codes.contains(&SpecIssueCode::JobRequiresExclusive));
    }

    #[test]
    fn normalization_is_idempotent_on_explicit_values() {
        let s = input(vec![volume(false)]).normalize();
        let again = ServiceSpecInput {
            resource_id: s.resource_id.clone(),
            mode: s.mode.clone(),
            task: s.task.clone(),
            update: UpdateConfigInput {
                order: Some(s.update.order),
                ..UpdateConfigInput::default()
            },
            rollback: UpdateConfigInput::default(),
            endpoint: s.endpoint.clone(),
            lifecycle: LifecycleInput {
                failover_policy: Some(s.lifecycle.failover.policy),
                exclusive: Some(s.lifecycle.exclusive),
                ..LifecycleInput::default()
            },
        }
        .normalize();
        assert_eq!(again, s);
    }
}
