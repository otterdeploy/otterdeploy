//! Tenant lifecycle on one node: boot quarantine, grant admission, positive
//! stop certificates, barrier retirement and re-enrollment.
//!
//! Every path goes through the same per-slot lock and the Engine adapter's
//! submission lock, so apply, stop, the reconciler and cleanup never act on a
//! slot concurrently, and revocation always becomes durable before any stop is
//! sent.

use crate::container::{self, TranslateError};
use crate::watchdog::Progress;
use ed25519_dalek::SigningKey;
use otterd_engine::{
    AdapterError, ContainerView, EngineAdapter, EngineOp, HandleError, MutationSpec, SubmitResult,
    TransportError, object_name, restart_policy_body,
};
use otterd_journal::{Blocker, HoldPhase, NodeState, Submission};
use otterd_proto::U53;
use otterd_proto::command::CommandResult;
use otterd_proto::envelope::{PublicKey, SignContext, SignedEnvelope};
use otterd_proto::identity::{AuthorityRevocation, EnrollCertificate};
use otterd_proto::ids::{
    AttemptId, ContainerRef, GrantId, HoldId, Incarnation, MutationId, OpId, Sha256Hex, SlotRef,
};
use otterd_proto::journal::{
    AttemptReason, BackingIdentity, EngineOutcome, HoldRecord, Record, Retirement, WorkloadClass,
};
use otterd_proto::lifecycle::{
    AttemptReport, BarrierEvidence, ContainerObservation, EngineRestartPolicy, GrantState,
    HeldAttempt, MutationReport, ProcessObservation, SlotGrant, SlotReport, StopCertificate,
    SubmissionState,
};
use otterd_proto::spec::{MountKind, ServiceSpec};
use otterd_sys::host::container_cgroup;
use otterd_sys::staging::{
    ObjectIdentity, RetainedSource, StageObservation, observe_stage, staging_path_for, unstage,
};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug, thiserror::Error)]
pub enum NodeError {
    #[error("unauthorized: {0}")]
    Unauthorized(String),
    #[error("refused: {0}")]
    Refused(String),
    #[error("internal: {0}")]
    Internal(String),
}

impl From<HandleError> for NodeError {
    fn from(e: HandleError) -> Self {
        match e {
            HandleError::Journal(otterd_journal::JournalError::Transition(t)) => {
                Self::Refused(t.to_string())
            }
            other => Self::Internal(other.to_string()),
        }
    }
}

impl From<TransportError> for NodeError {
    fn from(e: TransportError) -> Self {
        Self::Internal(format!("engine: {e}"))
    }
}

impl From<AdapterError> for NodeError {
    fn from(e: AdapterError) -> Self {
        match e {
            AdapterError::Refused(m) => Self::Refused(m),
            AdapterError::Journal(j) => j.into(),
            other => Self::Internal(other.to_string()),
        }
    }
}

impl From<otterd_sys::SysError> for NodeError {
    fn from(e: otterd_sys::SysError) -> Self {
        Self::Internal(e.to_string())
    }
}

impl From<TranslateError> for NodeError {
    fn from(e: TranslateError) -> Self {
        Self::Refused(e.to_string())
    }
}

/// Node configuration the lifecycle needs.
#[derive(Debug, Clone)]
pub struct LifecycleConfig {
    pub staging_root: PathBuf,
    /// Stop grace when a command does not name one.
    pub stop_grace: Duration,
    /// Engine boot-barrier profile; empty = disabled (the default). Only a
    /// profile validated for this Engine may retire Submitted work from an
    /// earlier kernel boot.
    pub boot_barrier_profile: String,
    /// How long an earlier process's exclusive grant stays held (paused)
    /// waiting for the control plane to adopt or stop it, before it is
    /// stopped and certified.
    pub hold_bound: Duration,
}

/// Whether tenant work may start. Closed on a platform host until the control
/// plane reports recovered authority.
#[derive(Debug, Clone, Serialize)]
pub struct TenantGate {
    pub open: bool,
    pub reason: String,
}

#[derive(Debug)]
pub struct Node {
    pub cfg: LifecycleConfig,
    pub engine: EngineAdapter,
    /// Replaced in place when a key rotation completes.
    identity_key: std::sync::RwLock<SigningKey>,
    pub incarnation: Incarnation,
    pub progress: Progress,
    pub engine_reachable: AtomicBool,
    pub gate: Mutex<TenantGate>,
    slot_locks: Mutex<BTreeMap<SlotRef, Arc<tokio::sync::Mutex<()>>>>,
    /// The Engine's latest answer per live container, for slot reports.
    observations: Mutex<BTreeMap<ContainerRef, Observation>>,
}

/// One container's latest observation.
#[derive(Debug, Clone)]
struct Observation {
    process: ProcessObservation,
    /// First observation that saw `process` as it is now.
    since: U53,
    /// When the request that produced it was sent: an older answer never
    /// replaces a newer one.
    taken: Instant,
}

/// Host paths no tenant grant may mount: otterd's journals, keys and staging,
/// and the Engine itself.
const PROTECTED_ROOTS: &[&str] = &[
    "/var/lib/otterd",
    "/etc/otterd",
    "/run/otterd",
    "/var/lib/docker",
    "/var/run/docker.sock",
    "/run/docker.sock",
    "/run/containerd",
    "/var/lib/containerd",
];

fn now_ms() -> U53 {
    otterd_journal::now_unix_ms()
}

impl Node {
    pub fn new(
        cfg: LifecycleConfig,
        engine: EngineAdapter,
        identity_key: SigningKey,
        incarnation: Incarnation,
        progress: Progress,
    ) -> Self {
        Self {
            cfg,
            engine,
            identity_key: std::sync::RwLock::new(identity_key),
            incarnation,
            progress,
            engine_reachable: AtomicBool::new(false),
            gate: Mutex::new(TenantGate {
                open: true,
                reason: "no platform bootstrap on this host".into(),
            }),
            slot_locks: Mutex::new(BTreeMap::new()),
            observations: Mutex::new(BTreeMap::new()),
        }
    }

    fn slot_lock(&self, slot: &SlotRef) -> Result<Arc<tokio::sync::Mutex<()>>, NodeError> {
        let mut locks = self
            .slot_locks
            .lock()
            .map_err(|_| NodeError::Internal("slot locks poisoned".into()))?;
        Ok(Arc::clone(locks.entry(slot.clone()).or_default()))
    }

    pub(crate) fn state(&self) -> Result<NodeState, NodeError> {
        Ok(self.engine.journal().snapshot()?)
    }

    fn grant_slot(&self, grant: &GrantId) -> Result<SlotRef, NodeError> {
        self.engine
            .journal()
            .read(|s| s.grants.get(grant).map(|g| g.grant.slot.clone()))?
            .ok_or_else(|| NodeError::Refused(format!("unknown grant {grant}")))
    }

    /// The identity key, for session proofs and certificates.
    pub(crate) fn identity_key(&self) -> SigningKey {
        match self.identity_key.read() {
            Ok(k) => k.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    /// Switch to a rotated identity key (already journalled and activated).
    pub(crate) fn set_identity_key(&self, key: SigningKey) {
        match self.identity_key.write() {
            Ok(mut k) => *k = key,
            Err(poisoned) => *poisoned.into_inner() = key,
        }
    }

    /// The node's public identity key.
    #[must_use]
    pub fn identity_public(&self) -> PublicKey {
        PublicKey::from_verifying_key(&self.identity_key().verifying_key())
    }

    // ---------------------------------------------------------------- reconcile

    /// Run at process start and on every reconcile pass. Exclusive grants of
    /// an earlier incarnation never authorize anything again: revoke them
    /// durably, retire their unsent work, stop their attempts and try to
    /// certify. Unresolved submissions keep the slot blocked; the control plane
    /// must wait for settlement or fence the host. Shared (overlap-tolerant)
    /// grants keep running and are reported, for the control plane to re-bind
    /// or stop; they authorize no new start.
    pub async fn reconcile(&self) -> Result<(), NodeError> {
        // Holds first: a stage lost while the node was down is recorded Unknown
        // before any cleanup could treat it as releasable.
        self.check_holds().await?;
        let reachable = self.engine.docker().ping().await.is_ok();
        self.engine_reachable.store(reachable, Ordering::SeqCst);
        if !reachable {
            // Engine reachability is a reconcile result, never a reason to stall.
            self.mark_unobserved("engine unreachable");
            return Ok(());
        }
        self.apply_boot_barrier().await?;
        let state = self.state()?;
        let now = now_ms().get();
        let bound = u64::try_from(self.cfg.hold_bound.as_millis()).unwrap_or(u64::MAX);
        let mut to_stop: Vec<(GrantId, &str)> = Vec::new();
        let mut to_hold: Vec<GrantId> = Vec::new();
        for g in state.grants.values() {
            if !stopped_by_reconcile(g, &self.incarnation) {
                continue;
            }
            let id = g.grant.grant_id.clone();
            match &g.held {
                _ if g.revoked.is_some() => to_stop.push((id, "revoked")),
                Some(h) if h.incarnation == self.incarnation => {
                    if now.saturating_sub(h.since_unix_ms.get()) > bound {
                        to_stop.push((id, "held past its bound without adoption"));
                    }
                }
                _ => to_hold.push(id),
            }
        }
        for grant in to_hold {
            match self.hold(&grant).await {
                Ok(true) => {}
                Ok(false) => to_stop.push((grant, "process restart: not eligible to be held")),
                Err(e) => tracing::warn!(%grant, error = %e, "hold incomplete"),
            }
        }
        for (grant, reason) in to_stop {
            if let Err(e) = self.try_stop_and_certify(&grant, reason).await {
                tracing::warn!(%grant, error = %e, "quarantine stop incomplete");
            }
        }
        self.observe().await;
        self.check_holds().await
    }

    // ---------------------------------------------------------- observation

    /// Ask the Engine about the container of every attempt of an unreleased
    /// grant. One request that times out marks the rest `Unknown` instead of
    /// waiting on each in turn, so a pass costs at most one Engine timeout.
    pub async fn observe(&self) {
        let pass = Instant::now();
        let Ok(state) = self.state() else {
            return;
        };
        let live = live_containers(&state);
        if let Ok(mut map) = self.observations.lock() {
            map.retain(|c, o| live.contains(c) || o.taken >= pass);
        }
        let mut stalled: Option<String> = None;
        for container in &live {
            if let Some(reason) = &stalled {
                self.record_observation(
                    container,
                    ProcessObservation::Unknown {
                        reason: reason.clone(),
                    },
                    Instant::now(),
                );
                continue;
            }
            if let Err(TransportError::Timeout(t)) = self.observe_container(container).await {
                stalled = Some(format!("engine did not answer an inspect within {t:?}"));
            }
        }
    }

    /// Inspect one container and record the answer (or why there is none).
    async fn observe_container(&self, container: &ContainerRef) -> Result<(), TransportError> {
        let taken = Instant::now();
        let (process, result) = match self.engine.inspect(container.as_str()).await {
            Ok(view) => (view_obs(view.as_ref()), Ok(())),
            Err(e) => (
                ProcessObservation::Unknown {
                    reason: format!("engine inspect failed: {e}"),
                },
                Err(e),
            ),
        };
        self.record_observation(container, process, taken);
        result
    }

    fn record_observation(
        &self,
        container: &ContainerRef,
        process: ProcessObservation,
        taken: Instant,
    ) {
        let Ok(mut map) = self.observations.lock() else {
            return;
        };
        match map.get_mut(container) {
            Some(o) if o.taken > taken => {}
            Some(o) => {
                if o.process != process {
                    o.process = process;
                    o.since = now_ms();
                }
                o.taken = taken;
            }
            None => {
                map.insert(
                    container.clone(),
                    Observation {
                        process,
                        since: now_ms(),
                        taken,
                    },
                );
            }
        }
    }

    /// The Engine could not be asked at all: nothing observed earlier still
    /// stands.
    fn mark_unobserved(&self, reason: &str) {
        let containers: Vec<ContainerRef> = match self.observations.lock() {
            Ok(map) => map.keys().cloned().collect(),
            Err(_) => return,
        };
        for c in containers {
            self.record_observation(
                &c,
                ProcessObservation::Unknown {
                    reason: reason.to_owned(),
                },
                Instant::now(),
            );
        }
    }

    /// What a slot report says about one attempt's process, and since when.
    fn attempt_process(
        &self,
        grant: &otterd_journal::GrantState,
        container: Option<&ContainerRef>,
        mutations: &[&otterd_journal::MutationState],
    ) -> (ProcessObservation, Option<U53>) {
        let Some(container) = container else {
            // No container recorded: absent unless a request may still have
            // created one.
            let unresolved = mutations.iter().any(|m| {
                matches!(
                    m.submission,
                    Submission::Submitted { .. } | Submission::Retired { .. }
                )
            });
            return if unresolved {
                (
                    ProcessObservation::Unknown {
                        reason: "no container recorded and a request is unresolved".into(),
                    },
                    None,
                )
            } else {
                (ProcessObservation::Absent, None)
            };
        };
        // A certified stop's final observation is the last word on its
        // containers; anything else comes from the latest pass.
        let known = grant
            .certificate
            .as_ref()
            .and_then(|c| c.decode_own_payload::<StopCertificate>().ok())
            .and_then(|cert| {
                cert.containers
                    .into_iter()
                    .find(|o| &o.container == container)
                    .map(|o| (o.process, Some(cert.issued_at_unix_ms)))
            })
            .or_else(|| {
                self.observations
                    .lock()
                    .ok()
                    .and_then(|map| map.get(container).cloned())
                    .map(|o| (o.process, Some(o.since)))
            });
        known.unwrap_or_else(|| {
            (
                ProcessObservation::Unknown {
                    reason: if grant.is_released() {
                        "not observed since the grant was released".into()
                    } else {
                        "not observed yet".into()
                    },
                },
                None,
            )
        })
    }

    async fn apply_boot_barrier(&self) -> Result<(), NodeError> {
        let profile = self.cfg.boot_barrier_profile.trim();
        if profile.is_empty() {
            return Ok(());
        }
        let boot = self.engine.boot_id().clone();
        let state = self.state()?;
        let candidates: Vec<_> = state
            .unresolved_submissions()
            .filter_map(|m| match &m.submission {
                Submission::Submitted { boot_id, .. } if boot_id != &boot => {
                    Some((m.record.clone(), boot_id.clone()))
                }
                _ => None,
            })
            .collect();
        for (record, submitted_boot) in candidates {
            let target = record
                .container
                .as_ref()
                .map_or_else(|| record.object_name.clone(), ToString::to_string);
            let quiet = match self.engine.inspect(&target).await? {
                None => true,
                Some(v) => {
                    v.restart_policy == "no"
                        && !matches!(v.process, ProcessObservation::Running { .. })
                }
            };
            if !quiet {
                tracing::warn!(mutation = %record.mutation_id, "boot barrier refused: object running or restart policy not `no`");
                continue;
            }
            self.engine
                .journal()
                .append(Record::MutationRetired {
                    mutation_id: record.mutation_id.clone(),
                    retirement: Retirement::HostReboot {
                        submitted_boot_id: submitted_boot,
                        observed_boot_id: boot.clone(),
                        profile: profile.to_owned(),
                    },
                })
                .await?;
            tracing::info!(mutation = %record.mutation_id, "retired by the validated host-reboot barrier");
        }
        Ok(())
    }

    /// A staged hold whose kernel mount vanished (reboot, manual unmount)
    /// becomes Unknown: its claim stays and it is never re-staged from the
    /// tenant path.
    async fn check_holds(&self) -> Result<(), NodeError> {
        let state = self.state()?;
        for h in state.open_holds() {
            if let HoldPhase::Staged { backing, .. } = &h.phase {
                let expected = ObjectIdentity {
                    dev: backing.dev.get(),
                    ino: backing.ino.get(),
                    mnt_id: backing.mnt_id.get(),
                };
                let obs = observe_stage(Path::new(&h.record.staging_path), &expected)?;
                if !matches!(obs, StageObservation::Present { .. }) {
                    self.engine
                        .journal()
                        .append(Record::HoldUnknown {
                            hold_id: h.record.hold_id.clone(),
                            reason: format!("stage observation: {obs:?}"),
                        })
                        .await?;
                    tracing::warn!(hold = %h.record.hold_id, ?obs, "retained stage lost: hold Unknown, claim kept");
                }
            }
        }
        Ok(())
    }

    // ---------------------------------------------------------------- apply

    /// Install a grant and start its first attempt.
    pub async fn apply(
        &self,
        grant: &SlotGrant,
        spec: &ServiceSpec,
        op_id: &OpId,
        spec_digest: Sha256Hex,
    ) -> Result<CommandResult, NodeError> {
        self.check_gate()?;
        if grant.slot.resource_id != spec.resource_id {
            return Err(NodeError::Refused(
                "grant and spec name different resources".into(),
            ));
        }
        check_tenant_scope(&grant.slot, spec)?;
        if let Some(attempt) = &grant.adopts_attempt {
            return self.adopt(grant, attempt, op_id, spec_digest).await;
        }
        if let Some(container) = &grant.adopts_container {
            return self
                .adopt_container(grant, container, op_id, spec_digest)
                .await;
        }
        let lock = self.slot_lock(&grant.slot)?;
        let _slot_guard = lock.lock().await;
        let state = self.state()?;
        let blockers: Vec<String> = state
            .slot_blockers(&grant.slot)
            .into_iter()
            .map(|b| format!("{b:?}"))
            .collect();
        if !blockers.is_empty() && grant.exclusive {
            return Err(NodeError::Refused(format!(
                "slot {} blocked: {}",
                grant.slot,
                blockers.join("; ")
            )));
        }
        self.refuse_unknown_inventory(&state, &grant.slot).await?;
        let journal = self.engine.journal();
        journal
            .append(Record::GrantAccepted {
                grant: grant.clone(),
                spec_digest,
                op_id: op_id.clone(),
            })
            .await?;
        journal
            .append(Record::QuarantineCleared {
                slot: grant.slot.clone(),
                grant_id: grant.grant_id.clone(),
                incarnation: self.incarnation.clone(),
            })
            .await?;
        let attempt = self.begin_attempt(grant, AttemptReason::Initial, 1).await?;
        let staged = self.stage_binds(spec, &grant.slot, &attempt).await?;
        let body = container::create_body(spec, &staged)?;
        let name = object_name(&grant.slot, &attempt);
        let mutation = |op| MutationSpec {
            class: WorkloadClass::Tenant,
            slot: grant.slot.clone(),
            grant_id: Some(grant.grant_id.clone()),
            attempt_id: attempt.clone(),
            op,
        };
        let guard = |s: &NodeState| start_guard(s, &grant.grant_id, &grant.slot, &self.incarnation);
        let create = self
            .engine
            .submit(
                mutation(EngineOp::Create {
                    name: name.clone(),
                    config: body,
                }),
                guard,
            )
            .await?;
        if let SubmitResult::Settled {
            outcome: EngineOutcome::Created { container },
            ..
        } = &create
        {
            self.engine
                .submit(
                    mutation(EngineOp::Start {
                        container: container.clone(),
                        name,
                    }),
                    guard,
                )
                .await?;
            // Best effort: the next pass observes it anyway.
            let _ = self.observe_container(container).await;
        }
        Ok(CommandResult::Applied {
            grant_id: grant.grant_id.clone(),
            attempt_id: attempt,
        })
    }

    /// Take over a running container started outside otterd, in place: its
    /// process keeps running and otterd never restarts it. The control plane
    /// already set its restart policy to `no`.
    async fn adopt_container(
        &self,
        grant: &SlotGrant,
        container: &ContainerRef,
        op_id: &OpId,
        spec_digest: Sha256Hex,
    ) -> Result<CommandResult, NodeError> {
        let lock = self.slot_lock(&grant.slot)?;
        let _slot_guard = lock.lock().await;
        let Some(v) = self.engine.inspect(container.as_str()).await? else {
            return Err(NodeError::Refused(format!(
                "container {container} does not exist"
            )));
        };
        if v.id != container.as_str() {
            return Err(NodeError::Refused(
                "adoptsContainer must name the full container id".into(),
            ));
        }
        if v.restart_policy != "no" {
            return Err(NodeError::Refused(format!(
                "container {container} has restart policy {:?}, not \"no\"",
                v.restart_policy
            )));
        }
        if v.labels.contains_key(otterd_engine::LABEL_MANAGED) {
            return Err(NodeError::Refused(
                "container is managed by otterd; adopt its attempt instead".into(),
            ));
        }
        let attempt = AttemptId::mint().map_err(|e| NodeError::Internal(e.to_string()))?;
        let journal = self.engine.journal();
        journal
            .append(Record::GrantAccepted {
                grant: grant.clone(),
                spec_digest,
                op_id: op_id.clone(),
            })
            .await?;
        journal
            .append(Record::QuarantineCleared {
                slot: grant.slot.clone(),
                grant_id: grant.grant_id.clone(),
                incarnation: self.incarnation.clone(),
            })
            .await?;
        journal
            .append(Record::ContainerAdopted {
                grant_id: grant.grant_id.clone(),
                attempt_id: attempt.clone(),
                container: container.clone(),
            })
            .await?;
        let _ = self.observe_container(container).await;
        tracing::info!(grant = %grant.grant_id, %container, "container adopted in place");
        Ok(CommandResult::Applied {
            grant_id: grant.grant_id.clone(),
            attempt_id: attempt,
        })
    }

    /// Give an adopted container back without stopping it: restore its
    /// restart policy, then release the grant. Idempotent.
    pub async fn release_adoption(
        &self,
        grant_id: &GrantId,
        policy: &EngineRestartPolicy,
    ) -> Result<CommandResult, NodeError> {
        let lock = self.slot_lock(&self.grant_slot(grant_id)?)?;
        let _slot_guard = lock.lock().await;
        let state = self.state()?;
        let g = state
            .grants
            .get(grant_id)
            .ok_or_else(|| NodeError::Refused(format!("unknown grant {grant_id}")))?;
        let (Some(container), Some(attempt)) = (g.adopted_container.clone(), g.attempts.first())
        else {
            return Err(NodeError::Refused(format!(
                "grant {grant_id} did not adopt a container"
            )));
        };
        let released = CommandResult::AdoptionReleased {
            grant_id: grant_id.clone(),
            container: container.clone(),
        };
        if g.adoption_released.is_some() {
            return Ok(released);
        }
        if g.is_released() || g.start_revoked() {
            return Err(NodeError::Refused(format!(
                "grant {grant_id} is released or being stopped"
            )));
        }
        let still_adopted = |s: &NodeState| {
            s.grants
                .get(grant_id)
                .filter(|g| !g.is_released() && !g.start_revoked())
                .map(|_| ())
                .ok_or_else(|| "the adoption ended".to_owned())
        };
        let r = self
            .engine
            .submit(
                MutationSpec {
                    class: WorkloadClass::Tenant,
                    slot: g.grant.slot.clone(),
                    grant_id: Some(grant_id.clone()),
                    attempt_id: attempt.clone(),
                    op: EngineOp::UpdateRestartPolicy {
                        container: container.clone(),
                        name: container.to_string(),
                        body: restart_policy_body(policy),
                    },
                },
                still_adopted,
            )
            .await?;
        match r {
            SubmitResult::Settled {
                outcome: EngineOutcome::Updated,
                ..
            } => {}
            SubmitResult::Settled {
                outcome: EngineOutcome::Absent,
                ..
            } => {
                return Err(NodeError::Refused(format!(
                    "container {container} is gone; stop the grant instead"
                )));
            }
            other => {
                return Err(NodeError::Internal(format!(
                    "restart policy update unresolved: {other:?}"
                )));
            }
        }
        self.engine
            .journal()
            .append(Record::AdoptionReleased {
                grant_id: grant_id.clone(),
                restart_policy: policy.clone(),
            })
            .await?;
        if let Ok(mut map) = self.observations.lock() {
            map.remove(&container);
        }
        tracing::info!(grant = %grant_id, %container, "adopted container given back");
        Ok(released)
    }

    /// `workload.remove`: delete a stopped grant's retained (adopted)
    /// containers. Their processes stay stopped; nothing restarts them.
    /// Idempotent.
    pub async fn remove(&self, grant_id: &GrantId) -> Result<CommandResult, NodeError> {
        let lock = self.slot_lock(&self.grant_slot(grant_id)?)?;
        let _slot_guard = lock.lock().await;
        let state = self.state()?;
        let g = state
            .grants
            .get(grant_id)
            .ok_or_else(|| NodeError::Refused(format!("unknown grant {grant_id}")))?;
        if g.certificate.is_none() {
            return Err(NodeError::Refused(format!(
                "grant {grant_id} has no stop certificate; stop it first"
            )));
        }
        let (Some(container), Some(attempt)) = (g.adopted_container.clone(), g.attempts.first())
        else {
            return Ok(CommandResult::Done);
        };
        let Some(v) = self.engine.inspect(container.as_str()).await? else {
            return Ok(CommandResult::Done);
        };
        if !v.process.is_positively_stopped() {
            return Err(NodeError::Refused(format!(
                "container {container} is {:?}, not stopped",
                v.process
            )));
        }
        let r = self
            .engine
            .submit(
                MutationSpec {
                    class: WorkloadClass::Tenant,
                    slot: g.grant.slot.clone(),
                    grant_id: Some(grant_id.clone()),
                    attempt_id: attempt.clone(),
                    op: EngineOp::Remove {
                        container: container.clone(),
                        name: v.name.clone(),
                    },
                },
                |_| Ok(()),
            )
            .await?;
        match r {
            SubmitResult::Settled {
                outcome: EngineOutcome::Removed | EngineOutcome::Absent,
                ..
            } => Ok(CommandResult::Done),
            other => Err(NodeError::Internal(format!("remove unresolved: {other:?}"))),
        }
    }

    fn check_gate(&self) -> Result<(), NodeError> {
        let gate = self
            .gate
            .lock()
            .map_err(|_| NodeError::Internal("gate poisoned".into()))?;
        if gate.open {
            Ok(())
        } else {
            Err(NodeError::Refused(format!(
                "tenant gate closed: {}",
                gate.reason
            )))
        }
    }

    async fn begin_attempt(
        &self,
        grant: &SlotGrant,
        reason: AttemptReason,
        ordinal: u32,
    ) -> Result<AttemptId, NodeError> {
        let attempt = AttemptId::mint().map_err(|e| NodeError::Internal(e.to_string()))?;
        self.engine
            .journal()
            .append(Record::AttemptBegun {
                grant_id: grant.grant_id.clone(),
                attempt_id: attempt.clone(),
                ordinal,
                reason,
            })
            .await?;
        Ok(attempt)
    }

    /// Labels aid inventory, never authority: a managed container for this
    /// slot that the journal does not know (journal loss, a foreign writer)
    /// blocks admission.
    async fn refuse_unknown_inventory(
        &self,
        state: &NodeState,
        slot: &SlotRef,
    ) -> Result<(), NodeError> {
        let known: BTreeSet<String> = state.attempts.keys().map(ToString::to_string).collect();
        let slot_label = slot.to_string();
        for c in self.engine.list_managed().await? {
            if c.labels.get(otterd_engine::LABEL_SLOT) == Some(&slot_label) {
                let attempt = c
                    .labels
                    .get(otterd_engine::LABEL_ATTEMPT)
                    .cloned()
                    .unwrap_or_default();
                if !known.contains(&attempt) {
                    return Err(NodeError::Refused(format!(
                        "container {} for slot {slot} is not in the journal",
                        c.name
                    )));
                }
            }
        }
        Ok(())
    }

    /// Hold and stage every bind that names a data identity; Docker gets only
    /// the stage. Returns target → staging path.
    async fn stage_binds(
        &self,
        spec: &ServiceSpec,
        slot: &SlotRef,
        attempt: &AttemptId,
    ) -> Result<BTreeMap<String, String>, NodeError> {
        let mut out = BTreeMap::new();
        for m in spec
            .task
            .mounts
            .iter()
            .filter(|m| m.kind == MountKind::Bind)
        {
            let (Some(identity), Some(source)) = (&m.data_identity, &m.source) else {
                continue;
            };
            let hold_id = HoldId::mint().map_err(|e| NodeError::Internal(e.to_string()))?;
            let staging = staging_path_for(&self.cfg.staging_root, hold_id.as_str());
            self.engine
                .journal()
                .append(Record::HoldIntent {
                    hold: HoldRecord {
                        hold_id: hold_id.clone(),
                        data_identity: identity.clone(),
                        claim_epoch: U53::ONE,
                        source_path: source.clone(),
                        staging_path: staging.display().to_string(),
                        slot: slot.clone(),
                        attempt_id: attempt.clone(),
                    },
                })
                .await?;
            let staged = RetainedSource::open(Path::new(source)).and_then(|src| {
                src.stage(&self.cfg.staging_root, &staging)
                    .map(|st| (src.identity(), st))
            });
            let (held, staged) = match staged {
                Ok(v) => v,
                Err(e) => {
                    self.engine
                        .journal()
                        .append(Record::HoldReleased {
                            hold_id,
                            reason: format!("staging refused: {e}"),
                        })
                        .await?;
                    return Err(NodeError::Refused(e.to_string()));
                }
            };
            let u = |v: u64| U53::new(v).unwrap_or(U53::MAX);
            self.engine
                .journal()
                .append(Record::HoldStaged {
                    hold_id,
                    backing: BackingIdentity {
                        dev: u(held.dev),
                        ino: u(held.ino),
                        mnt_id: u(held.mnt_id),
                    },
                    staging_mnt_id: u(staged.mnt_id),
                })
                .await?;
            out.insert(m.target.clone(), staging.display().to_string());
        }
        Ok(out)
    }

    // ---------------------------------------------------------------- stop

    /// Responsive-node positive stop: revoke under the submission lock, retire
    /// unsent work, stop and remove every resulting container, and certify only
    /// when every start-capable request is terminal and every container and
    /// cgroup is positively gone.
    pub async fn stop(
        &self,
        grant: &GrantId,
        reason: &str,
        op_id: &OpId,
        grace: Option<Duration>,
    ) -> Result<CommandResult, NodeError> {
        let lock = self.slot_lock(&self.grant_slot(grant)?)?;
        let _slot_guard = lock.lock().await;
        self.stop_locked(grant, reason, op_id, grace.unwrap_or(self.cfg.stop_grace))
            .await
    }

    pub(crate) async fn try_stop_and_certify(
        &self,
        grant: &GrantId,
        reason: &str,
    ) -> Result<Option<CommandResult>, NodeError> {
        let lock = self.slot_lock(&self.grant_slot(grant)?)?;
        let Ok(_slot_guard) = lock.try_lock() else {
            return Ok(None);
        };
        let op: OpId = "reconcile"
            .parse()
            .map_err(|_| NodeError::Internal("op id".into()))?;
        self.stop_locked(grant, reason, &op, self.cfg.stop_grace)
            .await
            .map(Some)
    }

    async fn revoke_and_retire_unsent(
        &self,
        grant: &GrantId,
        reason: &str,
    ) -> Result<(), NodeError> {
        let _lock = self.engine.lock().await;
        let state = self.state()?;
        let g = state
            .grants
            .get(grant)
            .ok_or_else(|| NodeError::Refused(format!("unknown grant {grant}")))?;
        if g.revoked.is_none() {
            self.engine
                .journal()
                .append(Record::GrantRevoked {
                    grant_id: grant.clone(),
                    reason: reason.to_owned(),
                })
                .await?;
        }
        let unsent: Vec<MutationId> = state
            .mutations_of_grant(grant)
            .filter(|m| matches!(m.submission, Submission::NotSubmitted))
            .map(|m| m.record.mutation_id.clone())
            .collect();
        for m in unsent {
            self.engine
                .journal()
                .append(Record::MutationRetired {
                    mutation_id: m,
                    retirement: Retirement::NotSubmitted,
                })
                .await?;
        }
        Ok(())
    }

    #[allow(clippy::too_many_lines)] // one ordered barrier procedure
    async fn stop_locked(
        &self,
        grant: &GrantId,
        reason: &str,
        op_id: &OpId,
        grace: Duration,
    ) -> Result<CommandResult, NodeError> {
        self.revoke_and_retire_unsent(grant, reason).await?;
        let state = self.state()?;
        let g = state
            .grants
            .get(grant)
            .ok_or_else(|| NodeError::Refused(format!("unknown grant {grant}")))?;
        if let Some(cert) = &g.certificate {
            return Ok(CommandResult::Stopped {
                certificate: cert.clone(),
            });
        }
        if g.superseded_by_epoch.is_some() {
            return Ok(CommandResult::StopUnresolved {
                grant_id: grant.clone(),
                reasons: vec!["the grant's node epoch was superseded by a re-enrollment".into()],
            });
        }
        let slot = g.grant.slot.clone();
        // Every container any mutation could have produced, including creates
        // whose answer was lost (found by their immutable attempt name).
        let mut targets: BTreeMap<String, (AttemptId, String)> = BTreeMap::new();
        // An adopted container is stopped but kept, so a rollback can start
        // it again; only `workload.remove` deletes it.
        let adopted = state
            .grants
            .get(grant)
            .and_then(|g| g.adopted_container.clone());
        if let Some(g) = state.grants.get(grant)
            && let (Some(c), Some(a)) = (&g.adopted_container, g.attempts.first())
        {
            targets.insert(c.to_string(), (a.clone(), c.to_string()));
        }
        for m in state.mutations_of_grant(grant) {
            let attempt = m.record.attempt_id.clone();
            if let Some(id) = m.container() {
                targets.insert(id.to_string(), (attempt, m.record.object_name.clone()));
            } else if m.record.verb == otterd_proto::lifecycle::EngineVerb::Create
                && let Some(v) = self.engine.inspect(&m.record.object_name).await?
            {
                targets.insert(v.id.clone(), (attempt, m.record.object_name.clone()));
            }
        }
        let grace_s = u32::try_from(grace.as_secs()).unwrap_or(u32::MAX);
        let mut observed = Vec::new();
        let mut cgroups_empty = true;
        for (id, (attempt, name)) in &targets {
            let container: ContainerRef = id
                .parse()
                .map_err(|_| NodeError::Internal(format!("container id {id}")))?;
            let spec = |op| MutationSpec {
                class: WorkloadClass::Tenant,
                slot: slot.clone(),
                grant_id: Some(grant.clone()),
                attempt_id: attempt.clone(),
                op,
            };
            let view = self.engine.inspect(id).await?;
            if let Some(v) = &view
                && matches!(
                    v.process,
                    ProcessObservation::Running { .. } | ProcessObservation::Unknown { .. }
                )
            {
                self.engine
                    .submit(
                        spec(EngineOp::Stop {
                            container: container.clone(),
                            name: name.clone(),
                            timeout_s: grace_s,
                        }),
                        |_| Ok(()),
                    )
                    .await?;
            }
            let retained = adopted.as_ref() == Some(&container);
            let view = self.engine.inspect(id).await?;
            if !retained
                && view_obs(view.as_ref()).is_positively_stopped()
                && view.is_some()
                && self.unresolved_starts(grant)?.is_empty()
            {
                // Remove so no mount or name survives; only after every request settled.
                self.engine
                    .submit(
                        spec(EngineOp::Remove {
                            container: container.clone(),
                            name: name.clone(),
                        }),
                        |_| Ok(()),
                    )
                    .await?;
            }
            let view = self.engine.inspect(id).await?;
            if !container_cgroup(id).is_empty() {
                cgroups_empty = false;
            }
            observed.push(ContainerObservation {
                retained,
                container,
                process: view_obs(view.as_ref()),
            });
        }
        let mut reasons: Vec<String> = self
            .unresolved_starts(grant)?
            .iter()
            .map(|m| format!("start-capable request {m} is submitted without a terminal answer"))
            .collect();
        if !cgroups_empty {
            reasons.push("a container cgroup is populated or unreadable".into());
        }
        for o in &observed {
            if !o.process.is_positively_stopped() {
                reasons.push(format!("container {} is {:?}", o.container, o.process));
            }
        }
        if !reasons.is_empty() {
            return Ok(CommandResult::StopUnresolved {
                grant_id: grant.clone(),
                reasons,
            });
        }
        let state = self.state()?;
        let identity = state
            .identity
            .as_ref()
            .ok_or_else(|| NodeError::Refused("no node identity".into()))?;
        let g = state
            .grants
            .get(grant)
            .ok_or_else(|| NodeError::Refused(format!("unknown grant {grant}")))?;
        let cert = StopCertificate {
            install_id: identity.install_id.clone(),
            node_id: identity.node_id.clone(),
            node_epoch: g.grant.node_epoch,
            slot,
            grant_id: grant.clone(),
            op_id: op_id.clone(),
            attempt_ids: g.attempts.clone(),
            containers: observed,
            cgroups_empty,
            mutation_inventory_digest: state.mutation_inventory_digest(grant),
            mutation_count: u32::try_from(state.mutations_of_grant(grant).count())
                .unwrap_or(u32::MAX),
            boot_id: self.engine.boot_id().clone(),
            issued_at_unix_ms: now_ms(),
        };
        let envelope =
            SignedEnvelope::sign(&self.identity_key(), SignContext::StopCertificate, &cert)
                .map_err(|e| NodeError::Internal(e.to_string()))?;
        self.engine
            .journal()
            .append(Record::StopCertified {
                grant_id: grant.clone(),
                certificate: envelope.clone(),
            })
            .await?;
        self.release_holds(grant).await?;
        tracing::info!(%grant, "positive stop certificate issued");
        Ok(CommandResult::Stopped {
            certificate: envelope,
        })
    }

    fn unresolved_starts(&self, grant: &GrantId) -> Result<Vec<MutationId>, NodeError> {
        Ok(self.engine.journal().read(|s| {
            s.mutations_of_grant(grant)
                .filter(|m| m.record.verb.can_start_process() && !m.submission.is_terminal())
                .map(|m| m.record.mutation_id.clone())
                .collect()
        })?)
    }

    /// Release holds of a certified grant: every referencing request settled,
    /// start authority revoked and the containers removed. An Unknown hold
    /// keeps its claim until an operator records evidence.
    async fn release_holds(&self, grant: &GrantId) -> Result<(), NodeError> {
        let state = self.state()?;
        let attempts: BTreeSet<&AttemptId> = state
            .grants
            .get(grant)
            .map(|g| g.attempts.iter().collect())
            .unwrap_or_default();
        for h in state.open_holds() {
            if !attempts.contains(&h.record.attempt_id)
                || matches!(h.phase, HoldPhase::Unknown { .. })
            {
                continue;
            }
            unstage(Path::new(&h.record.staging_path))?;
            self.engine
                .journal()
                .append(Record::HoldReleased {
                    hold_id: h.record.hold_id.clone(),
                    reason: format!("grant {grant} certified"),
                })
                .await?;
        }
        Ok(())
    }

    // ---------------------------------------------------------------- barriers and authority

    /// After a validated external fence and a controlled power-on, retire every
    /// unresolved Engine request on this node with the evidence.
    pub async fn retire_by_barrier(
        &self,
        evidence: &BarrierEvidence,
    ) -> Result<CommandResult, NodeError> {
        let _lock = self.engine.lock().await;
        let state = self.state()?;
        let epoch = state.identity.as_ref().map(|i| i.node_epoch);
        if epoch != Some(evidence.node_epoch) {
            return Err(NodeError::Refused(
                "barrier evidence names another node epoch".into(),
            ));
        }
        let pending: Vec<MutationId> = state
            .mutations
            .values()
            .filter(|m| !m.submission.is_terminal())
            .map(|m| m.record.mutation_id.clone())
            .collect();
        for m in &pending {
            self.engine
                .journal()
                .append(Record::MutationRetired {
                    mutation_id: m.clone(),
                    retirement: Retirement::ExternalBarrier {
                        evidence: evidence.clone(),
                    },
                })
                .await?;
        }
        Ok(CommandResult::Retired {
            mutation_count: u32::try_from(pending.len()).unwrap_or(u32::MAX),
        })
    }

    /// Accept a control-plane-signed re-enrollment with a higher epoch.
    pub async fn reenroll(&self, certificate: &SignedEnvelope) -> Result<CommandResult, NodeError> {
        let state = self.state()?;
        let id = state
            .identity
            .as_ref()
            .ok_or_else(|| NodeError::Refused("no node identity".into()))?;
        let keys: Vec<PublicKey> = id.cp_keys.iter().map(|k| k.key.clone()).collect();
        let cert: EnrollCertificate = certificate
            .verify(&keys, SignContext::Enroll)
            .map_err(|e| NodeError::Unauthorized(e.to_string()))?;
        if cert.install_id != id.install_id || cert.node_id != id.node_id {
            return Err(NodeError::Unauthorized(
                "enrollment addressed elsewhere".into(),
            ));
        }
        if cert.identity_key_id != self.identity_public().key_id() {
            return Err(NodeError::Unauthorized(
                "enrollment binds another identity key".into(),
            ));
        }
        self.engine
            .journal()
            .append(Record::Identity {
                install_id: cert.install_id,
                node_id: cert.node_id,
                node_epoch: cert.node_epoch,
                key_epoch: cert.key_epoch,
                identity_key_id: cert.identity_key_id,
                cp_keys: cert.cp_keys,
                recovery_key: cert.recovery_key,
                host: cert.host,
            })
            .await?;
        Ok(CommandResult::Done)
    }

    /// Apply a recovery-key-signed revocation of every term below a bound.
    pub async fn revoke_authority(&self, revocation: &SignedEnvelope) -> Result<U53, NodeError> {
        let state = self.state()?;
        let id = state
            .identity
            .as_ref()
            .ok_or_else(|| NodeError::Refused("no node identity".into()))?;
        let r: AuthorityRevocation = revocation
            .verify(
                std::slice::from_ref(&id.recovery_key),
                SignContext::AuthorityRevoke,
            )
            .map_err(|e| NodeError::Unauthorized(e.to_string()))?;
        if r.install_id != id.install_id || (!r.nodes.is_empty() && !r.nodes.contains(&id.node_id))
        {
            return Err(NodeError::Unauthorized(
                "revocation addressed elsewhere".into(),
            ));
        }
        let digest = revocation
            .payload_digest()
            .map_err(|e| NodeError::Internal(e.to_string()))?;
        self.engine
            .journal()
            .append(Record::AuthorityRevoked {
                below_term: r.below_term,
                revocation_digest: digest,
                reason: r.reason,
            })
            .await?;
        Ok(r.below_term)
    }

    // ---------------------------------------------------------------- reports

    /// Hold an earlier process's exclusive grant: pause its running container
    /// and journal the hold, instead of stopping it. `Ok(false)` when it is
    /// not eligible (revoked term, unresolved submissions, Unknown holds, or
    /// a container that is not the attempt's, not running, or restarts on
    /// its own); the caller stops it as before.
    async fn hold(&self, grant: &GrantId) -> Result<bool, NodeError> {
        let lock = self.slot_lock(&self.grant_slot(grant)?)?;
        let Ok(_slot_guard) = lock.try_lock() else {
            return Ok(true);
        };
        let state = self.state()?;
        let g = state
            .grants
            .get(grant)
            .ok_or_else(|| NodeError::Internal(format!("grant {grant} vanished")))?;
        if g.grant.authority_term < state.revoked_below_term() {
            return Ok(false);
        }
        if state.slot_blockers(&g.grant.slot).iter().any(|b| {
            matches!(
                b,
                Blocker::UnresolvedSubmission { .. } | Blocker::UnknownHold { .. }
            )
        }) {
            return Ok(false);
        }
        let Some(attempt) = g.attempts.last().cloned() else {
            return Ok(false);
        };
        let Some(container) = state.attempt_container(&attempt) else {
            return Ok(false);
        };
        let Some(v) = self.engine.inspect(container.as_ref()).await? else {
            return Ok(false);
        };
        if !matches!(v.process, ProcessObservation::Running { .. }) || v.restart_policy != "no" {
            return Ok(false);
        }
        let paused = match self
            .engine
            .submit(
                MutationSpec {
                    class: WorkloadClass::Tenant,
                    slot: g.grant.slot.clone(),
                    grant_id: Some(grant.clone()),
                    attempt_id: attempt.clone(),
                    op: EngineOp::Pause {
                        container: container.clone(),
                        name: v.name.clone(),
                    },
                },
                |_| Ok(()),
            )
            .await?
        {
            SubmitResult::Settled {
                outcome: EngineOutcome::Paused,
                ..
            } => true,
            // Already paused by the previous process.
            SubmitResult::Settled {
                outcome: EngineOutcome::Refused { .. },
                ..
            } => self.is_paused(&container).await,
            _ => return Ok(false),
        };
        self.engine
            .journal()
            .append(Record::GrantHeld {
                grant_id: grant.clone(),
                incarnation: self.incarnation.clone(),
                container,
                paused,
                since_unix_ms: now_ms(),
            })
            .await?;
        tracing::warn!(%grant, %attempt, paused, "held across the restart until the control plane adopts or stops it");
        Ok(true)
    }

    async fn is_paused(&self, container: &ContainerRef) -> bool {
        let Ok(r) = self
            .engine
            .docker()
            .get(&format!("/containers/{container}/json"))
            .await
        else {
            return false;
        };
        r.json::<serde_json::Value>().ok().is_some_and(|v| {
            v.get("State").and_then(|s| s.get("Paused")) == Some(&serde_json::Value::Bool(true))
        })
    }

    /// Adopt a held attempt under a new grant: the same container keeps
    /// running (unpaused), now under the new, higher generation.
    async fn adopt(
        &self,
        grant: &SlotGrant,
        attempt: &AttemptId,
        op_id: &OpId,
        spec_digest: Sha256Hex,
    ) -> Result<CommandResult, NodeError> {
        let lock = self.slot_lock(&grant.slot)?;
        let _slot_guard = lock.lock().await;
        let state = self.state()?;
        let (old, held) = state
            .grants
            .values()
            .find_map(|o| {
                let h = o.held.as_ref()?;
                (!o.is_released() && &h.attempt_id == attempt && h.incarnation == self.incarnation)
                    .then(|| (o.grant.grant_id.clone(), h.clone()))
            })
            .ok_or_else(|| NodeError::Refused(format!("no held attempt {attempt} to adopt")))?;
        let Some(v) = self.engine.inspect(held.container.as_ref()).await? else {
            return Err(NodeError::Refused(
                "the held container is gone; stop the old grant".into(),
            ));
        };
        if !matches!(v.process, ProcessObservation::Running { .. })
            || v.id != held.container.to_string()
        {
            return Err(NodeError::Refused(
                "the held container is not running; stop the old grant".into(),
            ));
        }
        let journal = self.engine.journal();
        journal
            .append(Record::GrantAccepted {
                grant: grant.clone(),
                spec_digest,
                op_id: op_id.clone(),
            })
            .await?;
        journal
            .append(Record::GrantAdopted {
                grant_id: old.clone(),
                by_grant: grant.grant_id.clone(),
                attempt_id: attempt.clone(),
            })
            .await?;
        journal
            .append(Record::QuarantineCleared {
                slot: grant.slot.clone(),
                grant_id: grant.grant_id.clone(),
                incarnation: self.incarnation.clone(),
            })
            .await?;
        if held.paused || self.is_paused(&held.container).await {
            let r = self
                .engine
                .submit(
                    MutationSpec {
                        class: WorkloadClass::Tenant,
                        slot: grant.slot.clone(),
                        grant_id: Some(grant.grant_id.clone()),
                        attempt_id: attempt.clone(),
                        op: EngineOp::Unpause {
                            container: held.container.clone(),
                            name: v.name.clone(),
                        },
                    },
                    |_| Ok(()),
                )
                .await?;
            if !matches!(r, SubmitResult::Settled { .. }) {
                return Err(NodeError::Internal(format!("unpause unresolved: {r:?}")));
            }
        }
        let _ = self.observe_container(&held.container).await;
        tracing::info!(old = %old, new = %grant.grant_id, %attempt, "held attempt adopted");
        Ok(CommandResult::Applied {
            grant_id: grant.grant_id.clone(),
            attempt_id: attempt.clone(),
        })
    }

    /// Journalled state of every slot, for `workload.inspect` and slot reports.
    pub fn slot_reports(&self) -> Result<Vec<SlotReport>, NodeError> {
        let state = self.state()?;
        Ok(state
            .grants
            .values()
            .map(|g| {
                let attempts = g
                    .attempts
                    .iter()
                    .enumerate()
                    .map(|(i, a)| {
                        let mutations: Vec<_> = state
                            .mutations_of_grant(&g.grant.grant_id)
                            .filter(|m| &m.record.attempt_id == a)
                            .collect();
                        let container = state.attempt_container(a);
                        let (process, since) =
                            self.attempt_process(g, container.as_ref(), &mutations);
                        AttemptReport {
                            attempt_id: a.clone(),
                            ordinal: u32::try_from(i + 1).unwrap_or(u32::MAX),
                            container,
                            process,
                            observed_since_unix_ms: since,
                            mutations: mutations
                                .iter()
                                .map(|m| MutationReport {
                                    mutation_id: m.record.mutation_id.clone(),
                                    verb: m.record.verb,
                                    state: match m.submission {
                                        Submission::NotSubmitted => SubmissionState::NotSubmitted,
                                        Submission::Submitted { .. } => SubmissionState::Submitted,
                                        Submission::Settled { .. } => SubmissionState::Settled,
                                        Submission::Retired { .. } => SubmissionState::Retired,
                                    },
                                })
                                .collect(),
                        }
                    })
                    .collect();
                let unresolved = state
                    .slot_blockers(&g.grant.slot)
                    .iter()
                    .any(|b| matches!(b, Blocker::UnresolvedSubmission { .. }));
                let grant_state = if g.is_released() {
                    GrantState::Released
                } else if unresolved || (g.revoked.is_some() && g.certificate.is_none()) {
                    GrantState::Unknown
                } else {
                    GrantState::Running
                };
                SlotReport {
                    slot: g.grant.slot.clone(),
                    grant_id: g.grant.grant_id.clone(),
                    generation: g.grant.generation,
                    state: grant_state,
                    quarantined: !state.is_cleared(&g.grant.slot),
                    revoked: g.start_revoked(),
                    attempts,
                    unknown_holds: state
                        .holds
                        .values()
                        .filter(|h| {
                            h.record.slot == g.grant.slot
                                && matches!(h.phase, HoldPhase::Unknown { .. })
                        })
                        .map(|h| h.record.hold_id.clone())
                        .collect(),
                    held: g
                        .held
                        .as_ref()
                        .filter(|_| !g.is_released())
                        .map(|h| HeldAttempt {
                            attempt_id: h.attempt_id.clone(),
                            paused: h.paused,
                        }),
                }
            })
            .collect())
    }
}

/// Approve a start-capable submission only for a live, cleared grant of this
/// incarnation on an otherwise unblocked slot.
pub fn start_guard(
    s: &NodeState,
    grant: &GrantId,
    slot: &SlotRef,
    incarnation: &Incarnation,
) -> Result<(), String> {
    let g = s
        .grants
        .get(grant)
        .ok_or_else(|| format!("grant {grant} unknown"))?;
    if g.start_revoked() {
        return Err(format!("grant {grant} revoked"));
    }
    if &g.grant.incarnation != incarnation {
        return Err("grant from another incarnation".into());
    }
    if !s.is_cleared(slot) {
        return Err(format!("slot {slot} quarantined in this incarnation"));
    }
    for b in s.slot_blockers(slot) {
        match b {
            Blocker::UnreleasedGrant { grant_id } if &grant_id == grant => {}
            other => return Err(format!("slot {slot} blocked: {other:?}")),
        }
    }
    Ok(())
}

/// Whether a reconcile pass stops this grant: a revoked grant, or an
/// exclusive grant from an earlier process incarnation (boot quarantine). A
/// shared grant from an earlier incarnation keeps running; it cannot start
/// anything new, because starts require the current incarnation.
fn stopped_by_reconcile(g: &otterd_journal::GrantState, incarnation: &Incarnation) -> bool {
    !g.is_released()
        && (g.revoked.is_some() || (g.grant.exclusive && &g.grant.incarnation != incarnation))
}

/// Tenants cannot hold platform or system slots or mount otterd's or the
/// Engine's own paths.
fn check_tenant_scope(slot: &SlotRef, spec: &ServiceSpec) -> Result<(), NodeError> {
    let resource = slot.resource_id.as_str();
    if resource.starts_with("platform/") || resource.starts_with("system/") {
        return Err(NodeError::Refused(format!(
            "resource {resource} is in a reserved namespace: tenants cannot hold platform or system slots"
        )));
    }
    for m in spec
        .task
        .mounts
        .iter()
        .filter(|m| m.kind == MountKind::Bind)
    {
        let Some(source) = &m.source else { continue };
        let p = Path::new(source);
        if !p.is_absolute()
            || p.components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err(NodeError::Refused(format!(
                "bind source {source} must be absolute without .."
            )));
        }
        let lexical: PathBuf = p.components().collect();
        if lexical == Path::new("/")
            || PROTECTED_ROOTS
                .iter()
                .any(|r| lexical.starts_with(r) || Path::new(r).starts_with(&lexical))
        {
            return Err(NodeError::Refused(format!(
                "bind source {source} intersects a protected platform or system root"
            )));
        }
    }
    Ok(())
}

/// The container of every attempt of an unreleased grant.
fn live_containers(state: &NodeState) -> BTreeSet<ContainerRef> {
    state
        .grants
        .values()
        .filter(|g| !g.is_released())
        .flat_map(|g| {
            state
                .mutations_of_grant(&g.grant.grant_id)
                .filter_map(|m| m.container().cloned())
                .chain(g.adopted_container.clone())
                .collect::<Vec<_>>()
        })
        .collect()
}

fn view_obs(v: Option<&ContainerView>) -> ProcessObservation {
    v.map_or(ProcessObservation::Absent, |v| v.process.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use otterd_proto::spec::ServiceSpecInput;

    fn grant_state(exclusive: bool, incarnation: &Incarnation) -> otterd_journal::GrantState {
        otterd_journal::GrantState {
            grant: SlotGrant {
                grant_id: "g".parse().unwrap(),
                slot: SlotRef::new("svc".parse().unwrap(), 0),
                generation: U53::ONE,
                authority_term: U53::ONE,
                node_epoch: U53::ONE,
                incarnation: incarnation.clone(),
                exclusive,
                disconnect_action: otterd_proto::spec::DisconnectAction::Stop,
                restart: otterd_proto::spec::RestartPolicy::default(),
                data_claims: vec![],
                probe_only: false,
                adopts_attempt: None,
                adopts_container: None,
            },
            spec_digest: Sha256Hex::digest(b"s"),
            op_id: "op".parse().unwrap(),
            revoked: None,
            certificate: None,
            superseded_by_epoch: None,
            attempts: vec![],
            held: None,
            adopted_by: None,
            adopted_container: None,
            adoption_released: None,
        }
    }

    #[test]
    fn a_restart_stops_exclusive_grants_only() {
        let (old, now) = (Incarnation::mint().unwrap(), Incarnation::mint().unwrap());
        assert!(
            stopped_by_reconcile(&grant_state(true, &old), &now),
            "exclusive, earlier incarnation"
        );
        assert!(
            !stopped_by_reconcile(&grant_state(false, &old), &now),
            "shared keeps running"
        );
        assert!(
            !stopped_by_reconcile(&grant_state(true, &now), &now),
            "current incarnation"
        );
        let mut revoked = grant_state(false, &old);
        revoked.revoked = Some("rollout".into());
        assert!(
            stopped_by_reconcile(&revoked, &now),
            "a revoked grant is always stopped"
        );
    }

    fn spec(resource: &str, source: &str) -> ServiceSpec {
        serde_json::from_value::<ServiceSpecInput>(serde_json::json!({
            "resourceId": resource,
            "task": {"container": {"image": {"reference": "x"}},
                     "mounts": [{"kind": "bind", "source": source, "target": "/d"}]}
        }))
        .unwrap()
        .normalize()
    }

    #[test]
    fn tenants_cannot_reach_platform_paths_or_slots() {
        let slot = |r: &str| SlotRef::new(r.parse().unwrap(), 0);
        assert!(check_tenant_scope(&slot("svc"), &spec("svc", "/srv/data")).is_ok());
        for bad in [
            "/var/run/docker.sock",
            "/var/lib/otterd/journal",
            "/",
            "/var",
            "/srv/../etc",
            "relative",
        ] {
            assert!(
                check_tenant_scope(&slot("svc"), &spec("svc", bad)).is_err(),
                "{bad}"
            );
        }
        assert!(check_tenant_scope(&slot("platform/pg"), &spec("platform/pg", "/srv/x")).is_err());
    }
}
