//! The daemon's side of the control session.
//!
//! Commands go through the [`Dispatcher`] (a fresh one per session: nonces are
//! per session) with the session's bounded clock. Slot reports follow `ready`
//! and every change. A control-plane signing-key transition is verified,
//! journalled and acknowledged; an authority revocation is applied.

use crate::dispatch::{Answer, Dispatcher, Session};
use crate::lifecycle::{Node, NodeError};
use otterd_identity::rotation::apply_cp_transition;
use otterd_proto::U53;
use otterd_proto::channel::ControlFrame;
use otterd_proto::envelope::{SignContext, SignedEnvelope};
use otterd_proto::identity::CrossSigned;
use otterd_proto::ids::SessionId;
use otterd_proto::journal::Record;
use otterd_proto::lifecycle::SlotReport;
use otterd_proto::version::Feature;
use otterd_transport::{Handler, IdentitySource, NodeIdentity, Outbox, RequestAnswer, SessionInfo};
use std::sync::{Arc, Mutex};

/// Features this daemon offers.
pub const FEATURES: &[Feature] = &[Feature::KeyRotation];

#[derive(Debug)]
pub struct ControlHandler {
    node: Arc<Node>,
    dispatcher: Mutex<Option<(SessionId, Arc<Dispatcher>)>>,
    reports: SlotReporter,
}

impl ControlHandler {
    #[must_use]
    pub fn new(node: Arc<Node>, reports: SlotReporter) -> Self {
        Self {
            node,
            dispatcher: Mutex::new(None),
            reports,
        }
    }

    fn dispatcher_for(&self, session: &SessionId) -> Arc<Dispatcher> {
        let Ok(mut g) = self.dispatcher.lock() else {
            return Arc::new(Dispatcher::new());
        };
        match &*g {
            Some((id, d)) if id == session => Arc::clone(d),
            _ => {
                let d = Arc::new(Dispatcher::new());
                *g = Some((session.clone(), Arc::clone(&d)));
                d
            }
        }
    }

    /// Verify, journal and acknowledge a control-plane key transition.
    async fn cp_key_transition(
        &self,
        session: &SessionInfo,
        transition: &CrossSigned,
    ) -> Result<ControlFrame, NodeError> {
        let clock = session
            .clock_now()
            .ok_or_else(|| NodeError::Refused("no bounded clock".into()))?;
        let state = self.node.state()?;
        let id = state
            .identity
            .as_ref()
            .ok_or_else(|| NodeError::Refused("no node identity".into()))?;
        // Judge validity at the earliest instant the clock allows: the outgoing
        // key must still be valid then.
        let now = clock.now_unix_ms.saturating_sub(clock.uncertainty_ms.get());
        let (t, cp_keys) = apply_cp_transition(&id.cp_keys, transition, &id.install_id, now)
            .map_err(|e| NodeError::Unauthorized(e.to_string()))?;
        self.node
            .engine
            .journal()
            .append(Record::CpKeysChanged { cp_keys })
            .await?;
        tracing::info!(key = %t.to.key.key_id(), epoch = %t.to.epoch, "control-plane key transition journalled");
        Ok(ControlFrame::CpKeyTransitionAck {
            key_id: t.to.key.key_id(),
            epoch: t.to.epoch,
        })
    }

    async fn authority(&self, document: &SignedEnvelope) {
        match document.context {
            SignContext::AuthorityRevoke => match self.node.revoke_authority(document).await {
                Ok(below) => tracing::warn!(%below, "authority revoked below term"),
                Err(e) => tracing::error!(error = %e, "authority revocation refused"),
            },
            other => {
                tracing::debug!(context = %other, "authority document not handled by this daemon yet");
            }
        }
    }
}

impl Handler for ControlHandler {
    async fn on_ready(&self, session: SessionInfo) -> Vec<ControlFrame> {
        self.dispatcher_for(&session.session_id);
        self.reports.reset();
        self.reports.frame(&self.node).into_iter().collect()
    }

    async fn request(
        &self,
        session: SessionInfo,
        capability: SignedEnvelope,
        payload: String,
    ) -> RequestAnswer {
        let d = self.dispatcher_for(&session.session_id);
        let s = Session {
            session_id: session.session_id.clone(),
            authority_term: session.authority_term,
            clock: session.clock_now(),
            monitor_only: false,
        };
        match d.handle(&self.node, &s, &capability, &payload).await {
            Answer::Refused(r) => RequestAnswer::Refused(r),
            Answer::Outcome {
                op_id,
                duplicate,
                outcome,
            } => RequestAnswer::Outcome {
                op_id,
                duplicate,
                outcome,
            },
        }
    }

    async fn frame(&self, session: SessionInfo, frame: ControlFrame) -> Vec<ControlFrame> {
        match frame {
            ControlFrame::CpKeyTransition { transition } if session.has(Feature::KeyRotation) => {
                match self.cp_key_transition(&session, &transition).await {
                    Ok(ack) => vec![ack],
                    Err(e) => {
                        tracing::error!(error = %e, "control-plane key transition refused");
                        vec![]
                    }
                }
            }
            ControlFrame::Authority { document } => {
                self.authority(&document).await;
                vec![]
            }
            other => {
                tracing::debug!(
                    kind = other.kind(),
                    "control frame not handled by this daemon yet"
                );
                vec![]
            }
        }
    }
}

/// Sends `slotReports` after `ready` and whenever the journalled slot state
/// changes, with an increasing sequence.
#[derive(Debug, Clone, Default)]
pub struct SlotReporter {
    inner: Arc<Mutex<ReporterState>>,
}

#[derive(Debug, Default)]
struct ReporterState {
    seq: u64,
    last: Option<(bool, Vec<SlotReport>)>,
}

impl SlotReporter {
    fn reset(&self) {
        if let Ok(mut g) = self.inner.lock() {
            g.last = None;
        }
    }

    /// The next report, if anything changed since the last one.
    fn frame(&self, node: &Node) -> Option<ControlFrame> {
        let slots = node.slot_reports().ok()?;
        let engine_reachable = node
            .engine_reachable
            .load(std::sync::atomic::Ordering::SeqCst);
        let mut g = self.inner.lock().ok()?;
        let current = (engine_reachable, slots);
        if g.last.as_ref() == Some(&current) {
            return None;
        }
        g.seq = g.seq.saturating_add(1);
        g.last = Some(current.clone());
        Some(ControlFrame::SlotReports {
            seq: U53::new(g.seq).unwrap_or(U53::MAX),
            quarantined: current.1.iter().any(|s| s.quarantined),
            engine_reachable: current.0,
            slots: current.1,
        })
    }

    /// After a reconcile pass: send a report if the state changed.
    pub fn after_pass(&self, node: &Node, outbox: &Outbox) {
        // Not connected: the next session starts with a full report.
        if let Some(f) = self.frame(node)
            && outbox.send(f).is_err()
        {
            self.reset();
        }
    }
}

/// The node identity the transport presents, re-read for every connection.
#[derive(Debug)]
pub struct NodeIdentitySource {
    node: Arc<Node>,
    version: String,
}

impl NodeIdentitySource {
    #[must_use]
    pub fn new(node: Arc<Node>, version: impl Into<String>) -> Self {
        Self {
            node,
            version: version.into(),
        }
    }
}

impl IdentitySource for NodeIdentitySource {
    fn identity(&self) -> Result<NodeIdentity, String> {
        let state = self.node.state().map_err(|e| e.to_string())?;
        let id = state.identity.ok_or("no node identity")?;
        Ok(NodeIdentity {
            install_id: id.install_id,
            node_id: id.node_id,
            node_epoch: id.node_epoch,
            key_epoch: id.key_epoch,
            signing: self.node.identity_key().clone(),
            boot_id: self.node.engine.boot_id().clone(),
            incarnation: self.node.incarnation.clone(),
            cp_keys: id.cp_keys,
            otterd_version: self.version.clone(),
            features: FEATURES.to_vec(),
            facts: None,
        })
    }
}
