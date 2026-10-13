//! Staged mesh key rotation.
//!
//! The procedure that rotated with zero loss: stage a second interface (new key, the other
//! address generation, another listen port, the same peers and `AllowedIPs`, **no route
//! changes**); prove traffic in **both directions** of every ordered pair on the staged path
//! (a handshake alone left the responder's keypair unconfirmed and cost a TCP break); switch
//! routes node by node (asymmetry is fine with loose `rp_filter`); wait until the old interface
//! carries only keepalives; delete it.
//!
//! Node-to-node control traffic must use the stable host mesh address (see
//! [`crate::ipam::Layout::mesh_stable`]), which moves with the route switch; traffic on the old
//! generation's addresses would keep the old interface busy and the drain would never end.
//!
//! [`Rotation`] is the pure driver: it says what to do next and advances on reported evidence.
//! Until routes switch, an abort only removes staged interfaces and costs nothing.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::ids::NodeId;
use crate::ipam::MeshGeneration;

/// Interface name for a generation: `<stem>0` for A, `<stem>1` for B (both match `<stem>*`).
#[must_use]
pub fn interface_name(stem: &str, generation: MeshGeneration) -> String {
    match generation {
        MeshGeneration::A => format!("{stem}0"),
        MeshGeneration::B => format!("{stem}1"),
    }
}

/// Listen port for a generation.
#[must_use]
pub const fn listen_port(generation: MeshGeneration) -> u16 {
    match generation {
        MeshGeneration::A => crate::mesh::PORT_RANGE.0,
        MeshGeneration::B => crate::mesh::PORT_RANGE.0 + 1,
    }
}

/// Bytes per drain window below which an interface counts as carrying only keepalives
/// (a drained interface moved 30–64 B per 8 s in testing).
pub const KEEPALIVE_ONLY_BYTES: u64 = 256;

/// Per-node facts checked before staging.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NodeReadiness {
    /// The firewall already admits the new listen port from peers.
    pub port_open: bool,
    /// `rp_filter` is loose (2) or off on the paths involved; strict breaks the asymmetric switch.
    pub rp_filter_loose: bool,
    /// The policy's mesh pattern matches both interface names.
    pub pattern_covers_both: bool,
}

/// Phase of a rotation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "phase")]
pub enum Phase {
    /// Staging the new interface on every node.
    Staging,
    /// Proving bidirectional traffic for every ordered pair.
    Verifying,
    /// Moving routes to the new interface.
    Switching,
    /// Waiting for the old interface to go quiet.
    Draining,
    /// Deleting the old interface.
    Removing,
    /// Finished; the new generation is the only one.
    Done,
    /// Aborted before any route moved; staged interfaces must be removed.
    Aborted {
        /// Why.
        reason: String,
    },
}

/// The next thing to do.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "do", content = "on")]
pub enum Action {
    /// Create the new interface on a node (new key, other generation, no routes).
    Stage(NodeId),
    /// Send traffic `from` → `to` over the staged interface and observe the reply.
    Verify {
        /// Sender.
        from: NodeId,
        /// Receiver.
        to: NodeId,
    },
    /// Point the node's peer routes at the new interface.
    SwitchRoutes(NodeId),
    /// Sample the old interface's transfer counters on a node.
    CheckDrain(NodeId),
    /// Delete the old interface on a node.
    RemoveOld(NodeId),
    /// Delete the staged interface on a node (abort path).
    RemoveStaged(NodeId),
}

/// Why a rotation cannot start.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RotationError {
    /// A node is not ready.
    #[error("node {node} is not ready: {why}")]
    NotReady {
        /// Node.
        node: NodeId,
        /// What is missing.
        why: &'static str,
    },
    /// Fewer than one node.
    #[error("no nodes to rotate")]
    Empty,
}

/// A rotation in progress. Journal it after every transition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rotation {
    /// Generation being replaced.
    pub from: MeshGeneration,
    /// Generation being introduced.
    pub to: MeshGeneration,
    nodes: BTreeSet<NodeId>,
    staged: BTreeSet<NodeId>,
    verified: BTreeSet<(NodeId, NodeId)>,
    switched: BTreeSet<NodeId>,
    drained: BTreeSet<NodeId>,
    removed: BTreeSet<NodeId>,
    phase: Phase,
}

impl Rotation {
    /// Starts a rotation away from `from` after checking every node's readiness.
    ///
    /// # Errors
    /// [`RotationError`] naming the first unready node.
    pub fn start(
        from: MeshGeneration,
        nodes: impl IntoIterator<Item = (NodeId, NodeReadiness)>,
    ) -> Result<Self, RotationError> {
        let mut set = BTreeSet::new();
        for (node, r) in nodes {
            let why = if !r.port_open {
                Some("the new listen port is not open to peers")
            } else if !r.rp_filter_loose {
                Some("rp_filter is strict; the route switch is asymmetric for a moment")
            } else if !r.pattern_covers_both {
                Some("the policy mesh pattern does not cover both interface names")
            } else {
                None
            };
            if let Some(why) = why {
                return Err(RotationError::NotReady { node, why });
            }
            set.insert(node);
        }
        if set.is_empty() {
            return Err(RotationError::Empty);
        }
        Ok(Self {
            from,
            to: from.other(),
            nodes: set,
            staged: BTreeSet::new(),
            verified: BTreeSet::new(),
            switched: BTreeSet::new(),
            drained: BTreeSet::new(),
            removed: BTreeSet::new(),
            phase: Phase::Staging,
        })
    }

    /// Current phase.
    #[must_use]
    pub const fn phase(&self) -> &Phase {
        &self.phase
    }

    fn pairs(&self) -> impl Iterator<Item = (NodeId, NodeId)> + '_ {
        self.nodes.iter().flat_map(|a| {
            self.nodes
                .iter()
                .filter(move |b| *b != a)
                .map(move |b| (a.clone(), b.clone()))
        })
    }

    /// What still has to happen in the current phase.
    #[must_use]
    pub fn pending(&self) -> Vec<Action> {
        match &self.phase {
            Phase::Staging => self
                .nodes
                .difference(&self.staged)
                .cloned()
                .map(Action::Stage)
                .collect(),
            Phase::Verifying => self
                .pairs()
                .filter(|p| !self.verified.contains(p))
                .map(|(from, to)| Action::Verify { from, to })
                .collect(),
            Phase::Switching => self
                .nodes
                .difference(&self.switched)
                .cloned()
                .map(Action::SwitchRoutes)
                .collect(),
            Phase::Draining => self
                .nodes
                .difference(&self.drained)
                .cloned()
                .map(Action::CheckDrain)
                .collect(),
            Phase::Removing => self
                .nodes
                .difference(&self.removed)
                .cloned()
                .map(Action::RemoveOld)
                .collect(),
            Phase::Aborted { .. } => self
                .staged
                .iter()
                .cloned()
                .map(Action::RemoveStaged)
                .collect(),
            Phase::Done => Vec::new(),
        }
    }

    fn advance(&mut self) {
        let next = match self.phase {
            Phase::Staging if self.staged == self.nodes => Phase::Verifying,
            Phase::Verifying if self.pairs().all(|p| self.verified.contains(&p)) => {
                Phase::Switching
            }
            Phase::Switching if self.switched == self.nodes => Phase::Draining,
            Phase::Draining if self.drained == self.nodes => Phase::Removing,
            Phase::Removing if self.removed == self.nodes => Phase::Done,
            _ => return,
        };
        self.phase = next;
        self.advance();
    }

    /// The staged interface exists on `node`.
    pub fn staged(&mut self, node: &NodeId) {
        if self.phase == Phase::Staging && self.nodes.contains(node) {
            self.staged.insert(node.clone());
            self.advance();
        }
    }

    /// Traffic `from` → `to` was answered over the staged path. Both ordered pairs of every
    /// node pair must be reported; a handshake without data does not count.
    pub fn verified(&mut self, from: &NodeId, to: &NodeId) {
        if self.phase == Phase::Verifying
            && self.nodes.contains(from)
            && self.nodes.contains(to)
            && from != to
        {
            self.verified.insert((from.clone(), to.clone()));
            self.advance();
        }
    }

    /// Routes on `node` now use the new interface.
    pub fn switched(&mut self, node: &NodeId) {
        if self.phase == Phase::Switching && self.nodes.contains(node) {
            self.switched.insert(node.clone());
            self.advance();
        }
    }

    /// The old interface on `node` moved `bytes` in the last drain window.
    pub fn drain_sample(&mut self, node: &NodeId, bytes: u64) {
        if self.phase == Phase::Draining
            && self.nodes.contains(node)
            && bytes <= KEEPALIVE_ONLY_BYTES
        {
            self.drained.insert(node.clone());
            self.advance();
        }
    }

    /// The old interface on `node` is gone.
    pub fn removed_old(&mut self, node: &NodeId) {
        if self.phase == Phase::Removing && self.nodes.contains(node) {
            self.removed.insert(node.clone());
            self.advance();
        }
    }

    /// Gives up. Only allowed before any route moved; afterwards the old path must stay until a
    /// switch back, so this returns `false` and changes nothing.
    pub fn abort(&mut self, reason: impl Into<String>) -> bool {
        if matches!(self.phase, Phase::Staging | Phase::Verifying) && self.switched.is_empty() {
            self.phase = Phase::Aborted {
                reason: reason.into(),
            };
            true
        } else {
            false
        }
    }

    /// A staged interface was removed after an abort.
    pub fn unstaged(&mut self, node: &NodeId) {
        if matches!(self.phase, Phase::Aborted { .. }) {
            self.staged.remove(node);
        }
    }

    /// A node that missed staging (offline) must not rejoin with the old configuration: it
    /// receives the new generation's configuration first.
    #[must_use]
    pub fn requires_new_config_on_rejoin(&self, node: &NodeId) -> bool {
        matches!(
            self.phase,
            Phase::Switching | Phase::Draining | Phase::Removing | Phase::Done
        ) && !self.switched.contains(node)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const READY: NodeReadiness = NodeReadiness {
        port_open: true,
        rp_filter_loose: true,
        pattern_covers_both: true,
    };

    fn n(s: &str) -> NodeId {
        NodeId::new(s).unwrap()
    }

    fn three() -> Rotation {
        Rotation::start(MeshGeneration::A, ["w1", "w2", "w3"].map(|s| (n(s), READY))).unwrap()
    }

    #[test]
    fn strict_rp_filter_blocks_the_start() {
        let bad = NodeReadiness {
            rp_filter_loose: false,
            ..READY
        };
        let err =
            Rotation::start(MeshGeneration::A, [(n("w1"), READY), (n("w2"), bad)]).unwrap_err();
        assert!(matches!(err, RotationError::NotReady { ref node, .. } if node.as_str() == "w2"));
    }

    #[test]
    fn verification_needs_both_directions_of_every_pair() {
        let mut r = three();
        for s in ["w1", "w2", "w3"] {
            r.staged(&n(s));
        }
        assert_eq!(*r.phase(), Phase::Verifying);
        assert_eq!(r.pending().len(), 6);
        for (a, b) in [("w1", "w2"), ("w1", "w3"), ("w2", "w3")] {
            r.verified(&n(a), &n(b));
        }
        assert_eq!(
            *r.phase(),
            Phase::Verifying,
            "one direction per pair is not enough"
        );
        for (a, b) in [("w2", "w1"), ("w3", "w1"), ("w3", "w2")] {
            r.verified(&n(a), &n(b));
        }
        assert_eq!(*r.phase(), Phase::Switching);
    }

    #[test]
    fn full_rotation_runs_to_done_and_cannot_abort_after_switching() {
        let mut r = three();
        let all = ["w1", "w2", "w3"].map(n);
        for x in &all {
            r.staged(x);
        }
        for a in &all {
            for b in &all {
                r.verified(a, b);
            }
        }
        r.switched(&all[0]);
        assert!(!r.abort("late"));
        assert!(r.requires_new_config_on_rejoin(&all[2]));
        for x in &all {
            r.switched(x);
        }
        r.drain_sample(&all[0], 5000);
        assert_eq!(*r.phase(), Phase::Draining, "still carrying data");
        for x in &all {
            r.drain_sample(x, 64);
        }
        assert_eq!(
            r.pending(),
            all.iter()
                .cloned()
                .map(Action::RemoveOld)
                .collect::<Vec<_>>()
        );
        for x in &all {
            r.removed_old(x);
        }
        assert_eq!(*r.phase(), Phase::Done);
        assert_eq!((r.from, r.to), (MeshGeneration::A, MeshGeneration::B));
    }

    #[test]
    fn abort_before_switch_only_removes_staged_interfaces() {
        let mut r = three();
        r.staged(&n("w1"));
        assert!(r.abort("w3 never staged"));
        assert_eq!(r.pending(), vec![Action::RemoveStaged(n("w1"))]);
        r.unstaged(&n("w1"));
        assert!(r.pending().is_empty());
    }

    #[test]
    fn names_and_ports_alternate() {
        assert_eq!(interface_name("otw", MeshGeneration::A), "otw0");
        assert_eq!(interface_name("otw", MeshGeneration::B), "otw1");
        assert_eq!(listen_port(MeshGeneration::B), 51821);
    }
}
