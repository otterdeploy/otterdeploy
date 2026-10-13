//! Capability verification, replay protection and operation claims for every
//! command the control plane sends.
//!
//! Order, for each request:
//!
//! 1. the capability envelope verifies against a control-plane key that is
//!    valid at the session's bounded clock (keys rotate with an overlap);
//! 2. [`Capability::check`] binds it to this install, node, epoch, session and
//!    term, a bounded clock, the payload's hash, the verb's permissions and the
//!    resource's operation-epoch high-water;
//! 3. the nonce is admitted once per session;
//! 4. the payload parses as a command for exactly the capability's verb;
//! 5. `opId + payloadHash` is claimed durably: the same claim with the same
//!    hash returns the recorded outcome, a different hash is a conflict;
//! 6. the command runs, and its terminal outcome is journalled.
//!
//! Steps 1–4 refuse without any side effect or journal record.

use crate::lifecycle::{Node, NodeError};
use crate::platform::Platform;
use crate::telemetry::Telemetry;
use crate::upgrade::Upgrader;
use otterd_identity::rotation::valid_cp_keys;
use otterd_journal::OpState;
use otterd_proto::U53;
use otterd_proto::capability::{
    Capability, CapabilityError, CheckContext, ClockBound, ReplayGuard,
};
use otterd_proto::channel::RequestRefusal;
use otterd_proto::command::{Command, CommandResult, OpOutcome, OperationRecord, SideEffects};
use otterd_proto::envelope::{SignContext, SignedEnvelope};
use otterd_proto::ids::{OpId, SessionId, Sha256Hex};
use otterd_proto::journal::{HighWaterKind, Record};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;

/// What the transport established for the current control session.
#[derive(Debug, Clone)]
pub struct Session {
    pub session_id: SessionId,
    pub authority_term: U53,
    /// Bounded wall-clock reading from the authenticated session; `None`
    /// refuses every new privileged operation.
    pub clock: Option<ClockBound>,
    pub monitor_only: bool,
    /// The negotiated protocol version.
    pub protocol: u16,
}

/// A request's answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Answer {
    /// Refused before any claim.
    Refused(RequestRefusal),
    /// The operation's outcome; `duplicate` when it was already claimed.
    Outcome {
        op_id: OpId,
        duplicate: bool,
        outcome: OpOutcome,
    },
}

#[derive(Debug, Default)]
pub struct Dispatcher {
    replay: Mutex<ReplayGuard>,
    upgrader: Option<Arc<Upgrader>>,
    platform: Option<Arc<Platform>>,
    telemetry: Option<Arc<Telemetry>>,
}

fn refuse(error: CapabilityError) -> Answer {
    Answer::Refused(RequestRefusal::Capability { error })
}

impl Dispatcher {
    /// A new session's dispatcher: nonces are per session.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Also run `platform.update` on this host's platform.
    #[must_use]
    pub fn and_platform(mut self, platform: Option<Arc<Platform>>) -> Self {
        self.platform = platform;
        self
    }

    /// Also run `health.configure` and `metrics.sample`.
    #[must_use]
    pub fn and_telemetry(mut self, telemetry: Option<Arc<Telemetry>>) -> Self {
        self.telemetry = telemetry;
        self
    }

    /// A dispatcher that can run `node.upgrade`.
    #[must_use]
    pub fn with_upgrader(upgrader: Arc<Upgrader>) -> Self {
        Self {
            upgrader: Some(upgrader),
            ..Self::default()
        }
    }

    pub async fn handle(
        &self,
        node: &Node,
        session: &Session,
        capability: &SignedEnvelope,
        payload: &str,
    ) -> Answer {
        let admitted = match self.admit(node, session, capability, payload) {
            Ok(a) => a,
            Err(answer) => return answer,
        };
        let Admitted {
            cap,
            command,
            payload_hash,
            capability_digest,
        } = admitted;
        let claim = node
            .engine
            .journal()
            .append(Record::OpClaimed {
                op_id: cap.op_id.clone(),
                verb: cap.verb,
                payload_hash: payload_hash.clone(),
                capability_digest,
                session_id: session.session_id.clone(),
                operation_epoch: cap.operation_epoch,
                resource_id: cap.resource_id.clone(),
            })
            .await;
        if let Err(e) = claim {
            return malformed(format!("claim: {e}"));
        }
        let outcome = match run(node, &cap, &command, &payload_hash, self, session).await {
            Ok(result) => OpOutcome::Completed { result },
            Err(NodeError::Refused(message)) => OpOutcome::Failed {
                code: "refused".into(),
                message,
                side_effects: SideEffects::None,
            },
            Err(NodeError::Unauthorized(message)) => OpOutcome::Failed {
                code: "unauthorized".into(),
                message,
                side_effects: SideEffects::None,
            },
            Err(NodeError::Internal(message)) => OpOutcome::Unknown { reason: message },
        };
        if let Err(e) = node
            .engine
            .journal()
            .append(Record::OpCompleted {
                op_id: cap.op_id.clone(),
                outcome: outcome.clone(),
            })
            .await
        {
            tracing::error!(op = %cap.op_id, error = %e, "could not journal an operation outcome");
        }
        Answer::Outcome {
            op_id: cap.op_id,
            duplicate: false,
            outcome,
        }
    }

    /// Steps 1–4 plus the duplicate check: everything decided before a claim.
    /// `Err` carries the final answer (a refusal or a recorded outcome).
    fn admit(
        &self,
        node: &Node,
        session: &Session,
        capability: &SignedEnvelope,
        payload: &str,
    ) -> Result<Admitted, Answer> {
        let state = node
            .engine
            .journal()
            .snapshot()
            .map_err(|e| malformed(format!("journal: {e}")))?;
        let identity = state
            .identity
            .as_ref()
            .ok_or_else(|| malformed("node has no identity".into()))?;
        let clock = session
            .clock
            .ok_or_else(|| refuse(CapabilityError::ClockUnknown))?;
        // A control-plane key is usable only if it is valid at the latest
        // instant the bounded clock allows.
        let cp_keys = valid_cp_keys(
            &identity.cp_keys,
            clock.now_unix_ms.saturating_add(clock.uncertainty_ms.get()),
        );
        let cap: Capability = capability
            .verify(&cp_keys, SignContext::Capability)
            .map_err(|e| malformed(format!("capability: {e}")))?;
        let high_water = cap.resource_id.as_ref().map_or(U53::ZERO, |r| {
            state.high_water(HighWaterKind::OperationEpoch, r.as_str())
        });
        let ctx = CheckContext {
            install_id: &identity.install_id,
            node_id: &identity.node_id,
            node_epoch: identity.node_epoch,
            session_id: &session.session_id,
            authority_term: session.authority_term,
            revoked_below_term: state.revoked_below_term(),
            clock: session.clock,
            operation_epoch_high_water: high_water,
            monitor_only: session.monitor_only,
        };
        cap.check(&ctx, payload.as_bytes()).map_err(refuse)?;
        let command: Command =
            serde_json::from_str(payload).map_err(|e| malformed(e.to_string()))?;
        if command.verb() != cap.verb {
            return Err(Answer::Refused(RequestRefusal::VerbMismatch));
        }
        self.replay
            .lock()
            .map_err(|_| CapabilityError::NonceCacheFull)
            .and_then(|mut g| g.admit(&cap, clock))
            .map_err(refuse)?;
        let payload_hash = Sha256Hex::digest(payload.as_bytes());
        if let Some(existing) = state.ops.get(&cap.op_id) {
            return Err(recorded(&cap.op_id, existing, &payload_hash));
        }
        let capability_digest = capability
            .payload_digest()
            .map_err(|e| malformed(e.to_string()))?;
        Ok(Admitted {
            cap,
            command,
            payload_hash,
            capability_digest,
        })
    }
}

struct Admitted {
    cap: Capability,
    command: Command,
    payload_hash: Sha256Hex,
    capability_digest: Sha256Hex,
}

fn malformed(detail: String) -> Answer {
    Answer::Refused(RequestRefusal::Malformed { detail })
}

fn recorded(op_id: &OpId, op: &OpState, payload_hash: &Sha256Hex) -> Answer {
    if &op.payload_hash != payload_hash {
        return Answer::Outcome {
            op_id: op_id.clone(),
            duplicate: true,
            outcome: OpOutcome::Conflict {
                recorded_payload_hash: op.payload_hash.clone(),
            },
        };
    }
    Answer::Outcome {
        op_id: op_id.clone(),
        duplicate: true,
        outcome: op.outcome.clone().unwrap_or(OpOutcome::Accepted),
    }
}

async fn run(
    node: &Node,
    cap: &Capability,
    command: &Command,
    payload_hash: &Sha256Hex,
    services: &Dispatcher,
    session: &Session,
) -> Result<CommandResult, NodeError> {
    if matches!(
        command,
        Command::HealthConfigure { .. }
            | Command::MetricsSample { .. }
            | Command::PlatformUpdate { .. }
            | Command::NodeUpgrade { .. }
    ) {
        return run_service(node, command, services, session).await;
    }
    match command {
        Command::WorkloadApply { grant, spec } => {
            if cap.binding.as_ref().is_some_and(|b| {
                b.grant_id != grant.grant_id
                    || b.slot != grant.slot
                    || b.generation != grant.generation
            }) {
                return Err(NodeError::Unauthorized(
                    "capability is bound to another grant".into(),
                ));
            }
            node.apply(grant, spec, &cap.op_id, payload_hash.clone())
                .await
        }
        Command::WorkloadStop {
            grant_id,
            reason,
            stop_grace_ms,
        } => {
            let grace = stop_grace_ms.map(|ms| Duration::from_millis(ms.get()));
            node.stop(grant_id, reason, &cap.op_id, grace).await
        }
        Command::WorkloadInspect { .. } => {
            node.observe().await;
            Ok(CommandResult::Slots {
                slots: node.slot_reports()?,
            })
        }
        Command::NodeRetireByBarrier { evidence } => node.retire_by_barrier(evidence).await,
        Command::NodeReenroll { certificate } => node.reenroll(certificate).await,
        Command::OpStatus { op_id } => {
            let state = node.engine.journal().snapshot()?;
            let op = state
                .ops
                .get(op_id)
                .ok_or_else(|| NodeError::Refused(format!("unknown op {op_id}")))?;
            Ok(CommandResult::Operation {
                record: Box::new(OperationRecord {
                    op_id: op_id.clone(),
                    verb: op.verb,
                    payload_hash: op.payload_hash.clone(),
                    claimed_at_unix_ms: op.claimed_at_unix_ms,
                    outcome: op.outcome.clone().unwrap_or(OpOutcome::Accepted),
                }),
            })
        }
        other => Err(NodeError::Refused(format!(
            "{} is not implemented by this daemon yet",
            other.verb()
        ))),
    }
}

/// Commands served by optional daemon services (telemetry, platform, A/B
/// updates).
async fn run_service(
    node: &Node,
    command: &Command,
    services: &Dispatcher,
    session: &Session,
) -> Result<CommandResult, NodeError> {
    match command {
        Command::HealthConfigure { checks, .. } => {
            let t = services
                .telemetry
                .as_ref()
                .ok_or_else(|| NodeError::Refused("telemetry is not running".into()))?;
            t.configure(checks).await
        }
        Command::MetricsSample { cache_ms, .. } => {
            let t = services
                .telemetry
                .as_ref()
                .ok_or_else(|| NodeError::Refused("telemetry is not running".into()))?;
            let samples = t
                .sample(
                    Duration::from_secs(60),
                    Duration::from_millis(cache_ms.get()),
                )
                .await;
            Ok(CommandResult::Document {
                schema: "otterd/metric-samples/v1".into(),
                body: serde_json::to_value(samples)
                    .map_err(|e| NodeError::Internal(e.to_string()))?,
            })
        }
        Command::PlatformUpdate { manifest } => {
            let platform = services
                .platform
                .clone()
                .ok_or_else(|| NodeError::Refused("this host runs no platform".into()))?;
            let host = otterd_sys::host::host_binding(None)
                .map_err(|e| NodeError::Internal(e.to_string()))?;
            let revoked = node.state()?.revoked_below_term();
            let digest = manifest
                .payload_digest()
                .map_err(|e| NodeError::Refused(e.to_string()))?;
            let manifest = manifest.clone();
            // The update stops the control plane that asked for it: run it on
            // its own and answer now; progress is in the platform status.
            tokio::spawn(async move {
                match platform.update(&manifest, &host, revoked).await {
                    Ok(id) => tracing::info!(update = %id, "platform update committed"),
                    Err(e) => tracing::error!(error = %e, "platform update stopped"),
                }
            });
            Ok(CommandResult::Document {
                schema: "otterd/platform-update-started/v1".into(),
                body: serde_json::json!({"manifestDigest": digest}),
            })
        }
        Command::NodeUpgrade { release } => {
            let upgrader = services.upgrader.as_deref().ok_or_else(|| {
                NodeError::Refused("this node is not installed for A/B updates".into())
            })?;
            let clock = session
                .clock
                .ok_or_else(|| NodeError::Refused("no bounded clock".into()))?;
            upgrader
                .upgrade(release, clock.now_unix_ms, session.protocol)
                .await
        }
        other => Err(NodeError::Refused(format!(
            "{} is not a service command",
            other.verb()
        ))),
    }
}
