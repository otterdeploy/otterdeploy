//! Leases: the control plane's periodic, signed confirmation that this node's
//! grants still stand.
//!
//! While a session is up the node sends `leaseRequest` every renewal interval
//! with a fresh nonce, recording the `CLOCK_BOOTTIME` instant it sent it. A
//! `lease` answer is accepted once, only for the outstanding nonce, signed by a
//! control-plane key valid on the session clock and naming this node, epoch,
//! boot and incarnation; its duration counts from the request's send instant,
//! so a slow answer or a paused VM never gains lease time.
//!
//! When no lease covers now, grants whose disconnect action is `stop` are
//! stopped and certified (after a grace of one lease duration for grants the
//! node has not yet asked a lease for). `continue-existing` grants keep
//! running: their ownership barrier stays held, and nothing new may start
//! without fresh control-plane authority. Lease expiry is never permission for
//! anyone to start a replacement; that still needs this node's stop
//! certificate or fence evidence.

use crate::lifecycle::{Node, NodeError};
use otterd_identity::rotation::valid_cp_keys;
use otterd_proto::capability::ClockBound;
use otterd_proto::channel::ControlFrame;
use otterd_proto::envelope::{SignContext, SignedEnvelope};
use otterd_proto::ids::{GrantId, Nonce};
use otterd_proto::lifecycle::{LEASE_DURATION_MS, LeaseRenewal, LeaseRequest};
use otterd_proto::spec::DisconnectAction;
use otterd_sys::host::boottime;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;
use std::time::Duration;

#[derive(Debug)]
struct Outstanding {
    nonce: Nonce,
    sent: Duration,
}

#[derive(Debug, Default)]
struct State {
    outstanding: Option<Outstanding>,
    /// Boot-clock instant the current lease ends.
    until: Option<Duration>,
    renewed: BTreeSet<GrantId>,
    /// When this process first saw each grant (boot clock).
    first_seen: BTreeMap<GrantId, Duration>,
}

#[derive(Debug, Default)]
pub struct LeaseKeeper {
    state: Mutex<State>,
}

/// What the node can report about its lease.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaseStatus {
    pub remaining_ms: Option<u64>,
    pub renewed_grants: Vec<GrantId>,
    pub outstanding: bool,
}

fn ms(d: Duration) -> u64 {
    u64::try_from(d.as_millis()).unwrap_or(u64::MAX)
}

impl LeaseKeeper {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// The next `leaseRequest`, replacing any unanswered one.
    pub fn request(&self, node: &Node) -> Result<ControlFrame, NodeError> {
        let state = node.state()?;
        let id = state
            .identity
            .as_ref()
            .ok_or_else(|| NodeError::Refused("no node identity".into()))?;
        let grants: Vec<GrantId> = state
            .grants
            .values()
            .filter(|g| !g.is_released() && g.grant.incarnation == node.incarnation)
            .map(|g| g.grant.grant_id.clone())
            .collect();
        let nonce = Nonce::random().map_err(|e| NodeError::Internal(e.to_string()))?;
        let mut s = self
            .state
            .lock()
            .map_err(|_| NodeError::Internal("lease state poisoned".into()))?;
        s.outstanding = Some(Outstanding {
            nonce: nonce.clone(),
            sent: boottime(),
        });
        Ok(ControlFrame::LeaseRequest(LeaseRequest {
            nonce,
            node_epoch: id.node_epoch,
            boot_id: node.engine.boot_id().clone(),
            incarnation: node.incarnation.clone(),
            grants,
        }))
    }

    /// Accept a `lease` answer.
    pub fn accept(
        &self,
        node: &Node,
        renewal: &SignedEnvelope,
        clock: Option<ClockBound>,
    ) -> Result<Duration, NodeError> {
        let clock = clock.ok_or_else(|| NodeError::Refused("no bounded clock".into()))?;
        let state = node.state()?;
        let id = state
            .identity
            .as_ref()
            .ok_or_else(|| NodeError::Refused("no node identity".into()))?;
        let keys = valid_cp_keys(&id.cp_keys, clock.now_unix_ms);
        let r: LeaseRenewal = renewal
            .verify(&keys, SignContext::Lease)
            .map_err(|e| NodeError::Unauthorized(e.to_string()))?;
        if r.install_id != id.install_id
            || r.node_id != id.node_id
            || r.node_epoch != id.node_epoch
            || &r.boot_id != node.engine.boot_id()
            || r.incarnation != node.incarnation
        {
            return Err(NodeError::Unauthorized(
                "lease for another node, boot or process".into(),
            ));
        }
        if r.authority_term < state.revoked_below_term() {
            return Err(NodeError::Unauthorized(
                "lease under a revoked authority term".into(),
            ));
        }
        let mut s = self
            .state
            .lock()
            .map_err(|_| NodeError::Internal("lease state poisoned".into()))?;
        let Some(out) = s.outstanding.take_if(|o| o.nonce == r.nonce) else {
            return Err(NodeError::Unauthorized(
                "lease for a nonce not outstanding".into(),
            ));
        };
        let until = out.sent + Duration::from_millis(r.duration_ms.get());
        s.until = Some(s.until.map_or(until, |u| u.max(until)));
        s.renewed = r.grants.into_iter().collect();
        Ok(until.saturating_sub(boottime()))
    }

    #[must_use]
    pub fn status(&self) -> LeaseStatus {
        let now = boottime();
        self.state.lock().map_or_else(
            |_| LeaseStatus {
                remaining_ms: None,
                renewed_grants: vec![],
                outstanding: false,
            },
            |s| LeaseStatus {
                remaining_ms: s.until.map(|u| ms(u.saturating_sub(now))),
                renewed_grants: s.renewed.iter().cloned().collect(),
                outstanding: s.outstanding.is_some(),
            },
        )
    }

    /// Grants to stop because no lease covers now.
    pub fn expired(&self, node: &Node) -> Result<Vec<GrantId>, NodeError> {
        let state = node.state()?;
        let now = boottime();
        let grace = Duration::from_millis(LEASE_DURATION_MS);
        let mut s = self
            .state
            .lock()
            .map_err(|_| NodeError::Internal("lease state poisoned".into()))?;
        let covered = s.until.is_some_and(|u| now < u);
        let mut out = Vec::new();
        for g in state.grants.values() {
            if g.is_released() || g.grant.incarnation != node.incarnation {
                continue;
            }
            let seen = *s.first_seen.entry(g.grant.grant_id.clone()).or_insert(now);
            if !covered
                && g.grant.disconnect_action == DisconnectAction::Stop
                && now.saturating_sub(seen) > grace
            {
                out.push(g.grant.grant_id.clone());
            }
        }
        Ok(out)
    }

    /// Stop and certify every grant [`LeaseKeeper::expired`] names.
    pub async fn enforce(&self, node: &Node) {
        let expired = match self.expired(node) {
            Ok(e) => e,
            Err(e) => {
                tracing::error!(error = %e, "cannot check leases");
                return;
            }
        };
        for grant in expired {
            tracing::warn!(%grant, "no lease covers this stop-on-disconnect grant: stopping");
            if let Err(e) = node.try_stop_and_certify(&grant, "lease expired").await {
                tracing::error!(%grant, error = %e, "lease-expiry stop incomplete");
            }
        }
    }
}

/// The renewal interval.
#[must_use]
pub fn renew_interval() -> Duration {
    Duration::from_millis(otterd_proto::lifecycle::LEASE_RENEW_INTERVAL_MS)
}
