//! N=1 platform bootstrap under the signed boot manifest.
//!
//! On a host that runs the control plane itself, otterd starts the platform
//! (Postgres, Redis, the control plane and its edge) with no control plane, no
//! registry and no tenant DNS: host binding, firewall baseline and legacy-unit
//! checks, the fixed platform network, then each member in dependency order,
//! each gated on its readiness. Every Engine mutation goes through the same
//! Submitted/Settled adapter as tenant work, journalled in a separate root-only
//! bootstrap journal; an unresolved submission blocks its member instead of
//! being assumed cancelled. A running member on the same image and config that
//! is ready is continued, never restarted.
//!
//! The control plane starts in recovery mode when the operator asks for it, or
//! when an update started it and it has not yet reported, with
//! `platform.recovered`, that it restored current operations and authority.
//! Leaving recovery mode is that journalled step and one deliberate restart,
//! never a side effect of a boot: the mode a member was created in is on its
//! own label, outside the config fingerprint, so a running control plane is
//! continued in whichever mode it runs.

use otterd_engine::{EngineAdapter, EngineOp, MutationSpec, SubmitResult};
use otterd_journal::{NodeState, Submission};
use otterd_proto::U53;
use otterd_proto::envelope::{PublicKey, SignContext, SignedEnvelope};
use otterd_proto::identity::HostBinding;
use otterd_proto::ids::{AttemptId, ContainerRef, Sha256Hex, SlotRef, UpdateId};
use otterd_proto::journal::{EngineOutcome, Record, Retirement, UpdatePhase, WorkloadClass};
use otterd_proto::platform::{
    ManifestError, PlatformBootManifest, PlatformMember, PlatformPreflight, PlatformReadiness,
    PlatformReport, PlatformUpdateReport,
};
use serde::Serialize;
use std::collections::BTreeMap;
use std::io::{Read as _, Write as _};
use std::net::{SocketAddr, TcpStream};
use std::os::unix::fs::{DirBuilderExt as _, OpenOptionsExt as _};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

#[derive(Debug, thiserror::Error)]
pub enum PlatformError {
    #[error(transparent)]
    Manifest(#[from] ManifestError),
    #[error(transparent)]
    Envelope(#[from] otterd_proto::envelope::EnvelopeError),
    #[error(transparent)]
    Journal(#[from] otterd_engine::HandleError),
    #[error("engine: {0}")]
    Engine(String),
    #[error("{0}")]
    Blocked(String),
    #[error("{path}: {source}")]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
}

fn io(path: impl Into<PathBuf>) -> impl FnOnce(std::io::Error) -> PlatformError {
    let path = path.into();
    move |source| PlatformError::Io { path, source }
}

fn engine(e: impl std::fmt::Display) -> PlatformError {
    PlatformError::Engine(e.to_string())
}

#[derive(Debug, Clone)]
pub struct PlatformConfig {
    /// Root-only directory holding the stored manifests (`manifests/`).
    pub dir: PathBuf,
    /// Engine host-reboot barrier profile; empty disables it.
    pub boot_barrier_profile: String,
    /// How long one member may take to become ready.
    pub ready_timeout: Duration,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformStatus {
    pub phase: String,
    pub blocked: Option<String>,
    pub manifest_digest: Option<Sha256Hex>,
    pub members: BTreeMap<String, String>,
    pub events: Vec<String>,
}

#[derive(Debug)]
pub struct Platform {
    cfg: PlatformConfig,
    engine: EngineAdapter,
    recovery_key: PublicKey,
    status: Mutex<PlatformStatus>,
    run: tokio::sync::Mutex<()>,
    /// The operator asked for recovery mode at the last boot.
    operator_recovery: AtomicBool,
}

/// The mode the members of one pass are created in, and whether a control
/// plane still running in recovery mode is due to leave it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Mode {
    /// Create members in recovery mode (with their recovery environment).
    recovery: bool,
    /// The journal records that the active manifest's control plane left
    /// recovery mode, and the operator does not hold it there: a member still
    /// running in recovery mode is restarted in normal mode, once.
    leave_recovery: bool,
}

impl Mode {
    /// The control plane an update starts: recovery mode, so it migrates and
    /// restores before serving.
    const UPDATE: Self = Self {
        recovery: true,
        leave_recovery: false,
    };
}

fn mode_name(recovery: bool) -> &'static str {
    if recovery { "recovery" } else { "normal" }
}

const MAX_EVENTS: usize = 64;

fn slot(m: &PlatformMember) -> Result<SlotRef, PlatformError> {
    let id = format!("platform/{}", m.name)
        .parse()
        .map_err(|_| PlatformError::Blocked(format!("member name {} is not a valid id", m.name)))?;
    Ok(SlotRef::new(id, 0))
}

impl Platform {
    #[must_use]
    pub fn new(cfg: PlatformConfig, engine: EngineAdapter, recovery_key: PublicKey) -> Self {
        Self {
            cfg,
            engine,
            recovery_key,
            status: Mutex::new(PlatformStatus::default()),
            run: tokio::sync::Mutex::new(()),
            operator_recovery: AtomicBool::new(false),
        }
    }

    #[must_use]
    pub fn engine(&self) -> &EngineAdapter {
        &self.engine
    }

    /// The status with the journalled update, as the control plane reads it.
    #[must_use]
    pub fn report(&self) -> PlatformReport {
        let s = self.status();
        let update = self
            .state()
            .ok()
            .and_then(|st| st.update)
            .map(|u| PlatformUpdateReport {
                update_id: u.update_id,
                phase: u.phase,
                irreversible: u.irreversible,
                from_manifest_digest: u.from_manifest_digest,
                to_manifest_digest: u.to_manifest_digest,
            });
        // The journal's active manifest is the truth; the boot status may predate an update.
        let manifest_digest = self
            .state()
            .ok()
            .and_then(|st| st.manifest)
            .map(|m| m.manifest_digest)
            .or(s.manifest_digest);
        PlatformReport {
            phase: if s.phase.is_empty() {
                "not-booted".into()
            } else {
                s.phase
            },
            blocked: s.blocked,
            manifest_digest,
            members: s.members,
            update,
        }
    }

    #[must_use]
    pub fn status(&self) -> PlatformStatus {
        self.status.lock().map(|s| s.clone()).unwrap_or_default()
    }

    fn set_status(&self, f: impl FnOnce(&mut PlatformStatus)) {
        if let Ok(mut s) = self.status.lock() {
            f(&mut s);
        }
    }

    fn event(&self, msg: String) {
        tracing::info!(platform = %msg);
        self.set_status(|s| {
            s.events.push(msg);
            let over = s.events.len().saturating_sub(MAX_EVENTS);
            s.events.drain(..over);
        });
    }

    fn state(&self) -> Result<NodeState, PlatformError> {
        Ok(self.engine.journal().snapshot()?)
    }

    fn manifest_path(&self, digest: &Sha256Hex) -> PathBuf {
        self.cfg
            .dir
            .join("manifests")
            .join(format!("{digest}.json"))
    }

    /// Activate the first manifest on this host (installer, daemon stopped).
    /// Changing an active manifest is a platform update, not an install.
    pub async fn install(
        &self,
        envelope: &SignedEnvelope,
        host: &HostBinding,
    ) -> Result<Sha256Hex, PlatformError> {
        let m: PlatformBootManifest = envelope.verify(
            std::slice::from_ref(&self.recovery_key),
            SignContext::PlatformBootManifest,
        )?;
        m.preflight()?;
        m.check_host(host)?;
        if let Some(active) = self.state()?.manifest {
            return Err(PlatformError::Blocked(format!(
                "manifest {} is active; changing it is a platform update",
                active.manifest_digest
            )));
        }
        let digest = self.store(envelope)?;
        self.engine
            .journal()
            .append(Record::ManifestActivated {
                manifest_digest: digest.clone(),
                manifest_revision: m.manifest_revision,
                bootstrap_epoch: m.bootstrap_epoch,
                authority_term: m.authority_term,
            })
            .await?;
        Ok(digest)
    }

    /// Keep a signed manifest under its digest (root-only, atomic).
    pub fn store(&self, envelope: &SignedEnvelope) -> Result<Sha256Hex, PlatformError> {
        let digest = envelope.payload_digest()?;
        let dir = self.cfg.dir.join("manifests");
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&dir)
            .map_err(io(&dir))?;
        let path = self.manifest_path(&digest);
        let tmp = path.with_extension("tmp");
        let _ = std::fs::remove_file(&tmp);
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&tmp)
            .map_err(io(&tmp))?;
        let bytes = serde_json::to_vec_pretty(envelope)
            .map_err(|e| PlatformError::Blocked(e.to_string()))?;
        f.write_all(&bytes)
            .and_then(|()| f.sync_all())
            .map_err(io(&tmp))?;
        std::fs::rename(&tmp, &path).map_err(io(&path))?;
        std::fs::File::open(&dir)
            .and_then(|d| d.sync_all())
            .map_err(io(&dir))?;
        Ok(digest)
    }

    /// The active manifest, re-verified from its stored copy.
    pub fn active(&self) -> Result<(Sha256Hex, PlatformBootManifest), PlatformError> {
        let active = self
            .state()?
            .manifest
            .ok_or_else(|| PlatformError::Blocked("no active platform manifest".into()))?;
        Ok((
            active.manifest_digest.clone(),
            self.load(&active.manifest_digest)?,
        ))
    }

    /// A stored manifest, re-verified against its digest and the recovery key.
    pub fn load(&self, digest: &Sha256Hex) -> Result<PlatformBootManifest, PlatformError> {
        let path = self.manifest_path(digest);
        let bytes = std::fs::read(&path).map_err(io(&path))?;
        let envelope: SignedEnvelope =
            serde_json::from_slice(&bytes).map_err(|e| PlatformError::Blocked(e.to_string()))?;
        if &envelope.payload_digest()? != digest {
            return Err(PlatformError::Blocked(format!(
                "{} does not hold the manifest its name says",
                path.display()
            )));
        }
        let m = envelope.verify(
            std::slice::from_ref(&self.recovery_key),
            SignContext::PlatformBootManifest,
        )?;
        Ok(m)
    }

    /// Boot the platform. `revoked_below_term` comes from the node journal: a
    /// recovery-root revocation retires every manifest below it.
    /// `recovery_mode` is the operator's request to start the control plane in
    /// recovery mode; without it, the journal decides: recovery mode until the
    /// control plane an update started reports `platform.recovered`.
    pub async fn boot(
        &self,
        host: &HostBinding,
        revoked_below_term: U53,
        recovery_mode: bool,
    ) -> Result<(), PlatformError> {
        let _run = self.run.lock().await;
        self.operator_recovery
            .store(recovery_mode, Ordering::Relaxed);
        let result = self.boot_locked(host, revoked_below_term).await;
        match &result {
            Ok(()) => self.set_status(|s| {
                s.phase = "up".into();
                s.blocked = None;
            }),
            Err(e) => {
                let reason = e.to_string();
                self.event(format!("blocked: {reason}"));
                self.set_status(|s| {
                    s.phase = "blocked".into();
                    s.blocked = Some(reason);
                });
            }
        }
        result
    }

    async fn boot_locked(
        &self,
        host: &HostBinding,
        revoked_below_term: U53,
    ) -> Result<(), PlatformError> {
        self.set_status(|s| s.phase = "preflight".into());
        if let Some(u) = self.state()?.update
            && !u.phase.is_terminal()
        {
            if u.irreversible || self.resume_marker().exists() {
                self.event(format!(
                    "resuming platform update {} forward from {:?}",
                    u.update_id, u.phase
                ));
                self.forward_locked(
                    &u.update_id,
                    u.phase,
                    &u.from_manifest_digest,
                    &u.to_manifest_digest,
                )
                .await?;
            } else {
                return Err(PlatformError::Blocked(format!(
                    "platform update {} was interrupted at {:?}, before the schema boundary: roll it back or resume it",
                    u.update_id, u.phase
                )));
            }
        }
        let (digest, m) = self.active()?;
        self.set_status(|s| s.manifest_digest = Some(digest.clone()));
        if m.authority_term < revoked_below_term {
            return Err(PlatformError::Blocked(format!(
                "the manifest is for authority term {} but the recovery root revoked everything below {revoked_below_term}",
                m.authority_term
            )));
        }
        m.check_host(host)?;
        host_preflight(&m.preflight)?;
        let order = m.preflight()?;
        self.event(format!(
            "start order: {}",
            order
                .iter()
                .map(|m| m.name.as_str())
                .collect::<Vec<_>>()
                .join(" -> ")
        ));
        let mode = self.mode(&digest)?;
        self.event(format!(
            "control plane mode: {}{}",
            mode_name(mode.recovery),
            if mode.leave_recovery {
                " (recovery left)"
            } else {
                ""
            }
        ));
        self.ensure_network(&m).await?;
        for member in order {
            self.set_status(|s| s.phase = format!("starting {}", member.name));
            self.ensure_member(&m, member, mode).await?;
        }
        Ok(())
    }

    /// The mode for the active manifest's members. Recovery mode when the
    /// operator asks for it, or when an update started this manifest's control
    /// plane (`NewCpStarted`) and the journal has no
    /// [`Record::PlatformRecoveryLeft`] for it; normal mode otherwise.
    fn mode(&self, active: &Sha256Hex) -> Result<Mode, PlatformError> {
        let state = self.state()?;
        let operator = self.operator_recovery.load(Ordering::Relaxed);
        let left = state.recovery_left.as_ref() == Some(active);
        let started_by_update = state.update.as_ref().is_some_and(|u| {
            &u.to_manifest_digest == active
                && matches!(u.phase, UpdatePhase::NewCpStarted | UpdatePhase::Committed)
        });
        Ok(Mode {
            recovery: operator || (started_by_update && !left),
            leave_recovery: left && !operator,
        })
    }

    /// `platform.recovered`: the control plane restored current operations
    /// and authority for the active manifest `digest`. Journals
    /// [`Record::PlatformRecoveryLeft`] once (a retry records nothing again)
    /// and answers whether the control plane still runs in recovery mode, that
    /// is whether [`Platform::finish_recovery`] restarts it. Refused for any
    /// manifest but the active one, and while an update is in progress.
    pub async fn leave_recovery(&self, digest: &Sha256Hex) -> Result<bool, PlatformError> {
        let _run = self.run.lock().await;
        let (active, m) = self.active()?;
        if digest != &active {
            return Err(PlatformError::Blocked(format!(
                "manifest {digest} is not the active one ({active})"
            )));
        }
        let state = self.state()?;
        if let Some(u) = state.update.filter(|u| !u.phase.is_terminal()) {
            return Err(PlatformError::Blocked(format!(
                "platform update {} is in progress at {:?}",
                u.update_id, u.phase
            )));
        }
        if state.recovery_left.as_ref() != Some(&active) {
            self.engine
                .journal()
                .append(Record::PlatformRecoveryLeft {
                    manifest_digest: active.clone(),
                })
                .await?;
            self.event(format!(
                "control plane left recovery mode for manifest {active}"
            ));
        }
        if self.operator_recovery.load(Ordering::Relaxed) {
            self.event(
                "the operator holds the control plane in recovery mode; it restarts in normal mode at the next boot without that request".into(),
            );
            return Ok(false);
        }
        let cp = control_plane(&m)?;
        let Some((_, container)) = self.created_containers(&slot(cp)?)?.pop() else {
            return Ok(false);
        };
        Ok(self
            .engine
            .inspect(container.as_ref())
            .await
            .map_err(engine)?
            .is_some_and(|v| v.process.is_live() && created_in_recovery(&v.labels)))
    }

    /// Restart the control plane in normal mode once the journal records that
    /// it left recovery mode: one deliberate, logged restart. A control plane
    /// already in normal mode is continued, so a second call restarts nothing.
    pub async fn finish_recovery(&self) -> Result<(), PlatformError> {
        let _run = self.run.lock().await;
        let (digest, m) = self.active()?;
        let mode = self.mode(&digest)?;
        if !mode.leave_recovery {
            return Ok(());
        }
        self.ensure_member(&m, control_plane(&m)?, mode).await
    }

    fn resume_marker(&self) -> PathBuf {
        self.cfg.dir.join("resume-forward")
    }

    async fn phase(
        &self,
        id: &UpdateId,
        phase: UpdatePhase,
        from: &Sha256Hex,
        to: &Sha256Hex,
    ) -> Result<(), PlatformError> {
        self.engine
            .journal()
            .append(Record::UpdatePhaseEntered {
                update_id: id.clone(),
                phase,
                from_manifest_digest: from.clone(),
                to_manifest_digest: to.clone(),
            })
            .await?;
        self.event(format!("update {id}: {phase:?}"));
        Ok(())
    }

    /// Update to a newer signed revision that names the active manifest as its
    /// predecessor. Every phase is journalled before its step runs to the
    /// next one: `Staged` (manifest kept, images loaded) → `CpQuiesced` (the
    /// control plane quiesced its writers before asking) → `CpStopped` →
    /// `SchemaBoundary` (the new control plane migrates the schema as it
    /// starts; from here only forward) → `NewCpStarted` (the new manifest is
    /// active and its members are up, the control plane in recovery mode) →
    /// `Committed`. An update interrupted before the boundary blocks boot until
    /// it is rolled back or resumed; after it, boot resumes it forward.
    pub async fn update(
        &self,
        envelope: &SignedEnvelope,
        host: &HostBinding,
        revoked_below_term: U53,
    ) -> Result<UpdateId, PlatformError> {
        let _run = self.run.lock().await;
        if let Some(u) = self.state()?.update
            && !u.phase.is_terminal()
        {
            return Err(PlatformError::Blocked(format!(
                "platform update {} is in progress at {:?}",
                u.update_id, u.phase
            )));
        }
        let (from, active) = self.active()?;
        let new: PlatformBootManifest = envelope.verify(
            std::slice::from_ref(&self.recovery_key),
            SignContext::PlatformBootManifest,
        )?;
        new.preflight()?;
        new.check_host(host)?;
        if new.manifest_revision <= active.manifest_revision {
            return Err(PlatformError::Blocked(format!(
                "revision {} is not newer than the active {}",
                new.manifest_revision, active.manifest_revision
            )));
        }
        if new.previous_manifest_digest.as_ref() != Some(&from) {
            return Err(PlatformError::Blocked(
                "the new manifest does not name the active one as its predecessor".into(),
            ));
        }
        if new.authority_term < active.authority_term || new.authority_term < revoked_below_term {
            return Err(PlatformError::Blocked(
                "an update never lowers the authority term, nor uses a revoked one".into(),
            ));
        }
        let to = self.store(envelope)?;
        let id = UpdateId::mint().map_err(engine)?;
        self.phase(&id, UpdatePhase::Staged, &from, &to).await?;
        for m in &new.members {
            self.ensure_image(m).await?;
        }
        self.forward_locked(&id, UpdatePhase::Staged, &from, &to)
            .await?;
        Ok(id)
    }

    async fn forward_locked(
        &self,
        id: &UpdateId,
        reached: UpdatePhase,
        from: &Sha256Hex,
        to: &Sha256Hex,
    ) -> Result<(), PlatformError> {
        let old = self.load(from)?;
        let new = self.load(to)?;
        let old_cp = control_plane(&old)?.clone();
        let steps = [
            UpdatePhase::CpQuiesced,
            UpdatePhase::CpStopped,
            UpdatePhase::SchemaBoundary,
            UpdatePhase::NewCpStarted,
            UpdatePhase::Committed,
        ];
        for step in steps.into_iter().filter(|s| *s > reached) {
            match step {
                UpdatePhase::CpStopped => self.stop_member(&old_cp).await?,
                UpdatePhase::NewCpStarted => {
                    self.stop_member(&old_cp).await?;
                    self.engine
                        .journal()
                        .append(Record::ManifestActivated {
                            manifest_digest: to.clone(),
                            manifest_revision: new.manifest_revision,
                            bootstrap_epoch: new.bootstrap_epoch,
                            authority_term: new.authority_term,
                        })
                        .await?;
                    self.set_status(|s| s.manifest_digest = Some(to.clone()));
                    self.ensure_network(&new).await?;
                    for m in new.preflight()? {
                        self.ensure_member(&new, m, Mode::UPDATE).await?;
                    }
                }
                UpdatePhase::Committed => {
                    let _ = std::fs::remove_file(self.resume_marker());
                }
                _ => {}
            }
            self.phase(id, step, from, to).await?;
        }
        Ok(())
    }

    /// Stop and remove every container a member's slot created.
    async fn stop_member(&self, m: &PlatformMember) -> Result<(), PlatformError> {
        let slot = slot(m)?;
        for (attempt, container) in self.created_containers(&slot)? {
            self.stop_remove(&slot, &attempt, &container).await?;
        }
        Ok(())
    }

    /// Roll back an interrupted update. Refused after the schema boundary
    /// (the journal enforces it too); the active manifest is unchanged, and the
    /// next boot starts its control plane again.
    pub async fn rollback(&self) -> Result<UpdateId, PlatformError> {
        let _run = self.run.lock().await;
        let u = self
            .state()?
            .update
            .filter(|u| !u.phase.is_terminal())
            .ok_or_else(|| PlatformError::Blocked("no platform update in progress".into()))?;
        if u.irreversible {
            return Err(PlatformError::Blocked(format!(
                "update {} crossed the schema boundary: only forward, or disaster recovery",
                u.update_id
            )));
        }
        self.phase(
            &u.update_id,
            UpdatePhase::RolledBack,
            &u.from_manifest_digest,
            &u.to_manifest_digest,
        )
        .await?;
        let _ = std::fs::remove_file(self.resume_marker());
        Ok(u.update_id)
    }

    /// Ask the next boot to continue an interrupted update forward.
    pub fn request_resume(&self) -> Result<UpdateId, PlatformError> {
        let u = self
            .state()?
            .update
            .filter(|u| !u.phase.is_terminal())
            .ok_or_else(|| PlatformError::Blocked("no platform update in progress".into()))?;
        let marker = self.resume_marker();
        std::fs::write(&marker, u.update_id.as_str()).map_err(io(&marker))?;
        Ok(u.update_id)
    }

    async fn ensure_network(&self, m: &PlatformBootManifest) -> Result<(), PlatformError> {
        let d = self.engine.docker();
        let r = d
            .get(&format!("/networks/{}", m.network.name))
            .await
            .map_err(engine)?;
        if r.status.is_success() {
            return Ok(());
        }
        let body = serde_json::json!({
            "Name": m.network.name, "Driver": "bridge", "CheckDuplicate": true,
            "IPAM": {"Config": [{"Subnet": m.network.subnet, "Gateway": m.network.gateway}]},
            "Labels": {"dev.otterdeploy.managed": "1", "dev.otterdeploy.class": "platform"},
        });
        let r = d
            .send(
                http::Method::POST,
                "/networks/create",
                Some(body.to_string().into()),
            )
            .await
            .map_err(engine)?;
        if !r.status.is_success() {
            return Err(engine(format!(
                "create platform network: {} {}",
                r.status,
                r.message()
            )));
        }
        self.event(format!("platform network {} created", m.network.name));
        Ok(())
    }

    /// One member: resolve earlier Engine work, continue a ready attempt on
    /// the same image and config in whichever mode it runs, otherwise replace
    /// it with a new attempt in `mode`. The one exception is the journalled
    /// exit from recovery mode, which restarts a member still in it.
    async fn ensure_member(
        &self,
        manifest: &PlatformBootManifest,
        m: &PlatformMember,
        mode: Mode,
    ) -> Result<(), PlatformError> {
        let slot = slot(m)?;
        self.retire_or_block(&slot).await?;
        let created = self.created_containers(&slot)?;
        // A member without a recovery environment is the same in both modes.
        let recovery = mode.recovery && !m.recovery_env.is_empty();
        let config = container_config(manifest, m, recovery);
        if self.continued(m, created.last(), &config, mode).await? {
            return Ok(());
        }
        for (attempt, container) in &created {
            self.stop_remove(&slot, attempt, container).await?;
        }
        self.ensure_image(m).await?;
        for d in &m.data {
            std::fs::DirBuilder::new()
                .recursive(true)
                .mode(0o700)
                .create(&d.root)
                .map_err(io(&d.root))?;
        }
        let attempt = AttemptId::mint().map_err(engine)?;
        let name = otterd_engine::object_name(&slot, &attempt);
        let spec = |op| MutationSpec {
            class: WorkloadClass::Platform,
            slot: slot.clone(),
            grant_id: None,
            attempt_id: attempt.clone(),
            op,
        };
        let create = self
            .engine
            .submit(
                spec(EngineOp::Create {
                    name: name.clone(),
                    config,
                }),
                |s| no_unresolved(s, &slot),
            )
            .await
            .map_err(engine)?;
        let container = match create {
            SubmitResult::Settled {
                outcome: EngineOutcome::Created { container },
                ..
            } => container,
            other => return Err(engine(format!("create {name}: {other:?}"))),
        };
        let start = self
            .engine
            .submit(
                spec(EngineOp::Start {
                    container: container.clone(),
                    name: name.clone(),
                }),
                |s| no_unresolved(s, &slot),
            )
            .await
            .map_err(engine)?;
        if !matches!(
            start,
            SubmitResult::Settled {
                outcome: EngineOutcome::Started | EngineOutcome::AlreadyStarted,
                ..
            }
        ) {
            return Err(engine(format!("start {name}: {start:?}")));
        }
        self.event(format!(
            "{}: started attempt {attempt} in {} mode",
            m.name,
            mode_name(recovery)
        ));
        let deadline = tokio::time::Instant::now() + self.cfg.ready_timeout;
        while !self.ready(m, container.as_ref()).await {
            if tokio::time::Instant::now() > deadline {
                return Err(PlatformError::Blocked(format!(
                    "{} not ready within {:?}",
                    m.name, self.cfg.ready_timeout
                )));
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        self.event(format!("{}: ready", m.name));
        self.set_status(|s| {
            s.members.insert(m.name.clone(), "ready".into());
        });
        Ok(())
    }

    /// Whether the newest attempt runs on the same image and config and is
    /// ready, so it is continued in whichever mode it runs. A member still in
    /// recovery mode after the journalled exit is not continued.
    async fn continued(
        &self,
        m: &PlatformMember,
        newest: Option<&(AttemptId, ContainerRef)>,
        config: &serde_json::Value,
        mode: Mode,
    ) -> Result<bool, PlatformError> {
        let Some((attempt, container)) = newest else {
            return Ok(false);
        };
        let Some(v) = self
            .engine
            .inspect(container.as_ref())
            .await
            .map_err(engine)?
        else {
            return Ok(false);
        };
        if !v.process.is_live()
            || self.image_of(&v.id).await? != m.image.id
            || v.labels.get(LABEL_CONFIG).map(String::as_str) != fingerprint(config)
        {
            return Ok(false);
        }
        let running = created_in_recovery(&v.labels);
        if running && mode.leave_recovery {
            self.event(format!(
                "{}: left recovery mode; restarting attempt {attempt} in normal mode",
                m.name
            ));
            return Ok(false);
        }
        if !self.ready(m, &v.id).await {
            return Ok(false);
        }
        self.event(format!(
            "{}: attempt {attempt} running and ready in {} mode; continued",
            m.name,
            mode_name(running)
        ));
        self.set_status(|s| {
            s.members.insert(m.name.clone(), "ready (continued)".into());
        });
        Ok(true)
    }

    /// Containers this slot's settled creates produced, oldest first.
    fn created_containers(
        &self,
        slot: &SlotRef,
    ) -> Result<Vec<(AttemptId, ContainerRef)>, PlatformError> {
        let state = self.state()?;
        let mut out: Vec<(U53, AttemptId, ContainerRef)> = state
            .mutations_of_slot(slot)
            .filter_map(|mu| match &mu.submission {
                Submission::Settled {
                    outcome: EngineOutcome::Created { container },
                } => Some((
                    mu.intent_seq,
                    mu.record.attempt_id.clone(),
                    container.clone(),
                )),
                _ => None,
            })
            .collect();
        out.sort_by_key(|(seq, _, _)| *seq);
        Ok(out.into_iter().map(|(_, a, c)| (a, c)).collect())
    }

    /// An unresolved start-capable submission blocks the member, unless it is
    /// from an earlier kernel boot, quiet now, and the operator enabled the
    /// host-reboot barrier.
    async fn retire_or_block(&self, slot: &SlotRef) -> Result<(), PlatformError> {
        let state = self.state()?;
        let profile = self.cfg.boot_barrier_profile.trim();
        let boot = self.engine.boot_id().clone();
        for mu in state.mutations_of_slot(slot) {
            let Submission::Submitted { boot_id, .. } = &mu.submission else {
                continue;
            };
            if !mu.record.verb.can_start_process() {
                continue;
            }
            let target = mu
                .record
                .container
                .as_ref()
                .map_or_else(|| mu.record.object_name.clone(), ToString::to_string);
            let quiet = match self.engine.inspect(&target).await.map_err(engine)? {
                None => true,
                Some(v) => v.restart_policy == "no" && !v.process.is_live(),
            };
            if boot_id != &boot && !profile.is_empty() && quiet {
                self.engine
                    .journal()
                    .append(Record::MutationRetired {
                        mutation_id: mu.record.mutation_id.clone(),
                        retirement: Retirement::HostReboot {
                            submitted_boot_id: boot_id.clone(),
                            observed_boot_id: boot.clone(),
                            profile: profile.to_owned(),
                        },
                    })
                    .await?;
                self.event(format!(
                    "{slot}: retired {} by the host-reboot barrier",
                    mu.record.mutation_id
                ));
                continue;
            }
            return Err(PlatformError::Blocked(format!(
                "unresolved platform submission {} ({:?} {}): never assumed cancelled",
                mu.record.mutation_id, mu.record.verb, mu.record.object_name
            )));
        }
        Ok(())
    }

    async fn stop_remove(
        &self,
        slot: &SlotRef,
        attempt: &AttemptId,
        container: &ContainerRef,
    ) -> Result<(), PlatformError> {
        let Some(v) = self
            .engine
            .inspect(container.as_ref())
            .await
            .map_err(engine)?
        else {
            return Ok(());
        };
        let spec = |op| MutationSpec {
            class: WorkloadClass::Platform,
            slot: slot.clone(),
            grant_id: None,
            attempt_id: attempt.clone(),
            op,
        };
        if v.process.is_live() {
            let r = self
                .engine
                .submit(
                    spec(EngineOp::Stop {
                        container: container.clone(),
                        name: v.name.clone(),
                        timeout_s: 30,
                    }),
                    |_| Ok(()),
                )
                .await
                .map_err(engine)?;
            if !matches!(
                r,
                SubmitResult::Settled {
                    outcome: EngineOutcome::Stopped
                        | EngineOutcome::AlreadyStopped
                        | EngineOutcome::Absent,
                    ..
                }
            ) {
                return Err(engine(format!("stop {}: {r:?}", v.name)));
            }
        }
        let r = self
            .engine
            .submit(
                spec(EngineOp::Remove {
                    container: container.clone(),
                    name: v.name.clone(),
                }),
                |_| Ok(()),
            )
            .await
            .map_err(engine)?;
        if !matches!(
            r,
            SubmitResult::Settled {
                outcome: EngineOutcome::Removed | EngineOutcome::Absent,
                ..
            }
        ) {
            return Err(engine(format!("remove {}: {r:?}", v.name)));
        }
        self.event(format!("{slot}: replaced attempt {attempt}"));
        Ok(())
    }

    async fn image_of(&self, container: &str) -> Result<String, PlatformError> {
        let r = self
            .engine
            .docker()
            .get(&format!("/containers/{container}/json"))
            .await
            .map_err(engine)?;
        let v: serde_json::Value = r.json().map_err(engine)?;
        Ok(v.get("Image")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_owned())
    }

    /// The exact image id must be present; load it from the local archive
    /// (checksum first) when it is not. Never pulled.
    async fn ensure_image(&self, m: &PlatformMember) -> Result<(), PlatformError> {
        let d = self.engine.docker();
        let have = d
            .get(&format!("/images/{}/json", m.image.id))
            .await
            .map_err(engine)?;
        if have.status.is_success() {
            return Ok(());
        }
        let bytes = std::fs::read(&m.image.archive).map_err(io(&m.image.archive))?;
        if Sha256Hex::digest(&bytes) != m.image.archive_sha256 {
            return Err(PlatformError::Blocked(format!(
                "{}: archive {} does not match its signed checksum",
                m.name, m.image.archive
            )));
        }
        let r = d.load_image(bytes.into()).await.map_err(engine)?;
        if !r.status.is_success() {
            return Err(engine(format!("load {}: {}", m.image.archive, r.message())));
        }
        let have = d
            .get(&format!("/images/{}/json", m.image.id))
            .await
            .map_err(engine)?;
        if !have.status.is_success() {
            return Err(PlatformError::Blocked(format!(
                "{}: archive {} does not contain image {}",
                m.name, m.image.archive, m.image.id
            )));
        }
        self.event(format!(
            "{}: loaded {} from its archive",
            m.name, m.image.id
        ));
        Ok(())
    }

    async fn ready(&self, m: &PlatformMember, container: &str) -> bool {
        match &m.readiness {
            PlatformReadiness::Tcp { port } => tcp_ok(&m.ip, *port),
            PlatformReadiness::Http { port, path } => http_ok(&m.ip, *port, path),
            PlatformReadiness::Exec { argv } => {
                self.exec_ok(container, argv).await.unwrap_or(false)
            }
        }
    }

    async fn exec_ok(&self, container: &str, argv: &[String]) -> Result<bool, PlatformError> {
        let d = self.engine.docker();
        let body = serde_json::json!({"Cmd": argv, "AttachStdout": false, "AttachStderr": false});
        let r = d
            .send(
                http::Method::POST,
                &format!("/containers/{container}/exec"),
                Some(body.to_string().into()),
            )
            .await
            .map_err(engine)?;
        let created: serde_json::Value = r.json().map_err(engine)?;
        let id = created
            .get("Id")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let start = serde_json::json!({"Detach": true, "Tty": false});
        d.send(
            http::Method::POST,
            &format!("/exec/{id}/start"),
            Some(start.to_string().into()),
        )
        .await
        .map_err(engine)?;
        // A detached exec: poll until it finishes, briefly.
        for _ in 0..20 {
            let r = d.get(&format!("/exec/{id}/json")).await.map_err(engine)?;
            let v: serde_json::Value = r.json().map_err(engine)?;
            if v.get("Running") == Some(&serde_json::Value::Bool(false)) {
                return Ok(v.get("ExitCode").and_then(serde_json::Value::as_i64) == Some(0));
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        Ok(false)
    }
}

fn no_unresolved(s: &NodeState, slot: &SlotRef) -> Result<(), String> {
    if s.mutations_of_slot(slot).any(|m| {
        matches!(m.submission, Submission::Submitted { .. }) && m.record.verb.can_start_process()
    }) {
        Err(format!("{slot} has an unresolved submission"))
    } else {
        Ok(())
    }
}

fn control_plane(m: &PlatformBootManifest) -> Result<&PlatformMember, PlatformError> {
    m.members
        .iter()
        .find(|m| m.role == otterd_proto::platform::PlatformRole::ControlPlane)
        .ok_or_else(|| PlatformError::Blocked("no control plane member".into()))
}

fn member_env(m: &PlatformMember, recovery_mode: bool) -> Vec<String> {
    let mut env: BTreeMap<&String, &String> = m.env.iter().collect();
    if recovery_mode {
        env.extend(m.recovery_env.iter());
    }
    env.into_iter().map(|(k, v)| format!("{k}={v}")).collect()
}

/// The Engine create body for a member. The config fingerprint covers the
/// normal-mode body, so it is the same in both modes; the mode is on
/// [`LABEL_RECOVERY`].
fn container_config(
    manifest: &PlatformBootManifest,
    m: &PlatformMember,
    recovery_mode: bool,
) -> serde_json::Value {
    let env = member_env(m, false);
    let binds: Vec<String> = m
        .data
        .iter()
        .map(|d| {
            format!(
                "{}:{}{}",
                d.root,
                d.target,
                if d.read_only { ":ro" } else { "" }
            )
        })
        .collect();
    let mut exposed = serde_json::Map::new();
    let mut bindings = serde_json::Map::new();
    for p in &m.publish {
        let key = format!("{}/tcp", p.container_port);
        exposed.insert(key.clone(), serde_json::json!({}));
        bindings.insert(
            key,
            serde_json::json!([{"HostIp": p.host_ip, "HostPort": p.host_port.to_string()}]),
        );
    }
    let mut body = serde_json::json!({
        "Image": m.image.id,
        "Env": env,
        "ExposedPorts": exposed,
        "HostConfig": {"Binds": binds, "PortBindings": bindings, "NetworkMode": manifest.network.name},
        "NetworkingConfig": {"EndpointsConfig": {manifest.network.name.clone(): {"IPAMConfig": {"IPv4Address": m.ip}}}},
    });
    if let Some(obj) = body.as_object_mut() {
        if !m.cmd.is_empty() {
            obj.insert("Cmd".into(), serde_json::json!(m.cmd));
        }
        // What the member was created from: a running member is continued
        // only when this is unchanged. The recovery environment is left out:
        // the mode is not part of what a member is, only of how it started.
        let fingerprint = Sha256Hex::digest(
            serde_json::Value::Object(obj.clone())
                .to_string()
                .as_bytes(),
        );
        if recovery_mode {
            obj.insert("Env".into(), serde_json::json!(member_env(m, true)));
        }
        obj.insert(
            "Labels".into(),
            serde_json::json!({
                LABEL_CONFIG: fingerprint,
                LABEL_RECOVERY: if recovery_mode { "1" } else { "0" },
            }),
        );
    }
    body
}

/// Label carrying a platform member's create-config fingerprint.
const LABEL_CONFIG: &str = "dev.otterdeploy.config";

/// Label recording the mode a platform member was created in: `1` for
/// recovery mode, `0` (or absent, before the label existed) for normal mode.
const LABEL_RECOVERY: &str = "dev.otterdeploy.recovery";

fn created_in_recovery(labels: &BTreeMap<String, String>) -> bool {
    labels.get(LABEL_RECOVERY).map(String::as_str) == Some("1")
}

fn fingerprint(body: &serde_json::Value) -> Option<&str> {
    body.get("Labels")?.get(LABEL_CONFIG)?.as_str()
}

/// Host checks before anything starts: the firewall baseline is loaded and
/// no legacy supervisor runs beside otterd.
fn host_preflight(p: &PlatformPreflight) -> Result<(), PlatformError> {
    if let Some(table) = &p.require_nft_table {
        let mut args = vec!["list", "table"];
        args.extend(table.split_whitespace());
        let out = std::process::Command::new("nft")
            .args(&args)
            .output()
            .map_err(io("nft"))?;
        if !out.status.success() {
            return Err(PlatformError::Blocked(format!(
                "firewall baseline table `{table}` is not loaded"
            )));
        }
    }
    for unit in &p.forbid_units {
        let out = std::process::Command::new("systemctl")
            .args(["is-active", unit])
            .output()
            .map_err(io("systemctl"))?;
        if String::from_utf8_lossy(&out.stdout).trim() == "active" {
            return Err(PlatformError::Blocked(format!(
                "legacy supervisor {unit} is active"
            )));
        }
    }
    Ok(())
}

fn addr(ip: &str, port: u16) -> Option<SocketAddr> {
    format!("{ip}:{port}").parse().ok()
}

fn tcp_ok(ip: &str, port: u16) -> bool {
    addr(ip, port).is_some_and(|a| TcpStream::connect_timeout(&a, Duration::from_secs(2)).is_ok())
}

fn http_ok(ip: &str, port: u16, path: &str) -> bool {
    let Some(a) = addr(ip, port) else {
        return false;
    };
    let Ok(mut s) = TcpStream::connect_timeout(&a, Duration::from_secs(2)) else {
        return false;
    };
    let _ = s.set_read_timeout(Some(Duration::from_secs(3)));
    if write!(s, "GET {path} HTTP/1.0\r\nHost: {ip}\r\n\r\n").is_err() {
        return false;
    }
    let mut buf = [0u8; 32];
    let n = s.read(&mut buf).unwrap_or(0);
    let head = String::from_utf8_lossy(buf.get(..n).unwrap_or_default());
    head.starts_with("HTTP/1.1 2") || head.starts_with("HTTP/1.0 2")
}

/// The manifests directory a platform config uses.
#[must_use]
pub fn manifests_dir(dir: &Path) -> PathBuf {
    dir.join("manifests")
}
