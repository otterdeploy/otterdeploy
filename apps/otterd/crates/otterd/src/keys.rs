//! Node key rotation over the control session.
//!
//! 1. The next key epoch is prepared in the key store and offered to the
//!    control plane as a cross-signed `keyRotation`. The same keys are offered
//!    again after a reconnect or a restart until they are acknowledged.
//! 2. A `keyRotationAck` signed by a control-plane key valid now, naming
//!    exactly the new key and epoch, completes it: `keysRotated` is journalled,
//!    the key store switches epochs, the daemon switches keys, and the session
//!    reconnects so the next handshake is proven with the new key.
//!
//! A crash between the journal and the key store is completed at the next
//! start (the journal decides); one before the journal leaves the old epoch
//! current and the prepared one is offered again.

use crate::lifecycle::{Node, NodeError};
use otterd_identity::rotation::{Enrolled, cross_sign, verify_rotation, verify_rotation_ack};
use otterd_identity::{KeyStore, NodeKeyset};
use otterd_proto::U53;
use otterd_proto::capability::ClockBound;
use otterd_proto::envelope::SignedEnvelope;
use otterd_proto::identity::{CrossSigned, KeyRotation};
use otterd_proto::journal::Record;
use std::sync::Mutex;

#[derive(Debug)]
struct Pending {
    rotation: KeyRotation,
    statement: CrossSigned,
    next: NodeKeyset,
}

#[derive(Debug)]
pub struct KeyRotator {
    store: KeyStore,
    pending: Mutex<Option<Pending>>,
}

fn internal(e: impl std::fmt::Display) -> NodeError {
    NodeError::Internal(e.to_string())
}

impl KeyRotator {
    #[must_use]
    pub fn new(store: KeyStore) -> Self {
        Self {
            store,
            pending: Mutex::new(None),
        }
    }

    /// The rotation statement for the next key epoch, preparing it if needed.
    pub fn statement(&self, node: &Node, reason: &str) -> Result<CrossSigned, NodeError> {
        let mut pending = self.pending.lock().map_err(internal)?;
        if let Some(p) = pending.as_ref() {
            return Ok(p.statement.clone());
        }
        let state = node.state()?;
        let id = state
            .identity
            .as_ref()
            .ok_or_else(|| NodeError::Refused("no node identity".into()))?;
        let current = self.store.load(id.key_epoch).map_err(internal)?;
        let next = self.store.prepare_next().map_err(internal)?;
        let statement = cross_sign(
            &current,
            &next,
            &id.install_id,
            &id.node_id,
            id.node_epoch,
            reason,
        )
        .map_err(internal)?;
        let enrolled_key = current.identity_public();
        let rotation = verify_rotation(
            &statement,
            Enrolled {
                install_id: &id.install_id,
                node_id: &id.node_id,
                identity: &enrolled_key,
                key_epoch: id.key_epoch,
            },
        )
        .map_err(internal)?;
        *pending = Some(Pending {
            rotation,
            statement: statement.clone(),
            next,
        });
        Ok(statement)
    }

    /// A rotation to offer at the start of a session: one in flight, or an
    /// epoch prepared before a restart and never journalled.
    pub fn to_offer(&self, node: &Node) -> Result<Option<CrossSigned>, NodeError> {
        if let Some(p) = self.pending.lock().map_err(internal)?.as_ref() {
            return Ok(Some(p.statement.clone()));
        }
        let state = node.state()?;
        let Some(id) = state.identity.as_ref() else {
            return Ok(None);
        };
        let next = id.key_epoch.saturating_add(1);
        if self.store.epochs().map_err(internal)?.contains(&next) {
            return self.statement(node, "resumed").map(Some);
        }
        Ok(None)
    }

    /// Complete the rotation in flight with the control plane's acknowledgement.
    /// Returns the new key epoch.
    pub async fn complete(
        &self,
        node: &Node,
        ack: &SignedEnvelope,
        clock: Option<ClockBound>,
    ) -> Result<U53, NodeError> {
        let clock = clock.ok_or_else(|| NodeError::Refused("no bounded clock".into()))?;
        let state = node.state()?;
        let id = state
            .identity
            .as_ref()
            .ok_or_else(|| NodeError::Refused("no node identity".into()))?;
        let Some(p) = self.pending.lock().map_err(internal)?.take() else {
            return Err(NodeError::Refused("no key rotation in flight".into()));
        };
        let checked = verify_rotation_ack(ack, &id.cp_keys, &p.rotation, clock.now_unix_ms);
        if let Err(e) = checked {
            let reason = e.to_string();
            // Keep offering the same keys.
            *self.pending.lock().map_err(internal)? = Some(p);
            return Err(NodeError::Unauthorized(reason));
        }
        let epoch = p.next.epoch();
        node.engine
            .journal()
            .append(Record::KeysRotated {
                key_epoch: epoch,
                identity_key_id: p.next.identity_public().key_id(),
            })
            .await?;
        self.store.activate(epoch).map_err(internal)?;
        node.set_identity_key(p.next.identity().clone());
        tracing::info!(%epoch, key = %p.next.identity_public().key_id(), "node key rotation complete");
        Ok(epoch)
    }
}
