//! The fleet address plan: one supernet carved into node slices, scope units,
//! stable service addresses and system ranges, with a no-reuse quarantine.
//!
//! Layout (defaults, all configurable):
//!
//! | Range | Default | Use |
//! |---|---|---|
//! | supernet | `172.24.0.0/13` | everything below |
//! | VIP | `172.31.0.0/16` (8 slices) | stable service addresses, never reused |
//! | system | `172.30.224.0/19` (1 slice) | mesh generations and DNS listeners |
//! | mesh | `172.30.224.0/23` | host mesh addresses: generation A and B interface addresses are its two
//! |  |  | first /25s; the second /24 holds each node's stable control address |
//! | DNS | `172.30.228.0/22` | per-environment resolver addresses |
//! | node slices | the remaining /19s | one per node, 256 /27 scope units each |
//!
//! The reserved ranges are taken before any node slice, so adding nodes can
//! never collide with them.
//!
//! Reuse rule: an address that a peer may still forward to (an endpoint, a
//! scope unit, a removed node's slice) returns to the free pool only after
//! **every** forwarding peer has acknowledged cleanup or has been fenced from
//! forwarding until it rejoins. Time alone never frees anything. Stable
//! service addresses are never reused at all.

use std::collections::{BTreeMap, BTreeSet};
use std::net::Ipv4Addr;

use serde::{Deserialize, Serialize};

use crate::addr::Ipv4Net;
use crate::ids::{NodeId, ScopeId, VipId};

/// Prefix length of a node slice.
pub const SLICE_LEN: u8 = 19;
/// Prefix length of one scope unit, the allocation and policy granule.
pub const UNIT_LEN: u8 = 27;
/// Largest managed network: a /24, eight units.
pub const LARGEST_SCOPE_LEN: u8 = 24;

/// Which of the two alternating mesh address generations is meant.
/// Key rotation stages the new interface on the other generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MeshGeneration {
    /// First /25 of the mesh range.
    A,
    /// Second /25 of the mesh range.
    B,
}

impl MeshGeneration {
    /// The generation a rotation moves to.
    #[must_use]
    pub const fn other(self) -> Self {
        match self {
            Self::A => Self::B,
            Self::B => Self::A,
        }
    }
}

/// How the supernet is divided. Validated once; every allocation trusts it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Layout {
    /// All managed addresses.
    pub supernet: Ipv4Net,
    /// Stable service addresses.
    pub vip: Ipv4Net,
    /// System ranges (mesh, DNS); must be whole slices.
    pub system: Ipv4Net,
    /// Host mesh addresses, both generations.
    pub mesh: Ipv4Net,
    /// Resolver listener addresses.
    pub dns: Ipv4Net,
}

/// A layout that cannot be used.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum LayoutError {
    /// A range is outside the range that must contain it.
    #[error("{what} {range} is not inside {outer}")]
    Outside {
        /// Which range.
        what: &'static str,
        /// The range.
        range: Ipv4Net,
        /// Where it should be.
        outer: Ipv4Net,
    },
    /// Two ranges that must be disjoint overlap.
    #[error("{a} and {b} overlap")]
    Overlap {
        /// First range.
        a: Ipv4Net,
        /// Second range.
        b: Ipv4Net,
    },
    /// A reserved range does not occupy whole node slices.
    #[error("{0} must be /{SLICE_LEN} or larger so it takes whole node slices")]
    NotSliceAligned(Ipv4Net),
    /// The supernet is smaller than one slice.
    #[error("supernet {0} must be /{SLICE_LEN} or larger")]
    SupernetTooSmall(Ipv4Net),
    /// The mesh range cannot hold two generations and the stable addresses.
    #[error("mesh range {0} must be exactly a /23 (two /25 generations and a stable /24)")]
    MeshShape(Ipv4Net),
}

impl Default for Layout {
    fn default() -> Self {
        let p = |a, b, c, d, l| Ipv4Net::truncate(Ipv4Addr::new(a, b, c, d), l);
        Self {
            supernet: p(172, 24, 0, 0, 13),
            vip: p(172, 31, 0, 0, 16),
            system: p(172, 30, 224, 0, 19),
            mesh: p(172, 30, 224, 0, 23),
            dns: p(172, 30, 228, 0, 22),
        }
    }
}

impl Layout {
    /// Checks containment, alignment and disjointness.
    ///
    /// # Errors
    /// The first violated rule.
    pub fn validate(&self) -> Result<(), LayoutError> {
        if self.supernet.prefix_len() > SLICE_LEN {
            return Err(LayoutError::SupernetTooSmall(self.supernet));
        }
        for (what, range, outer) in [
            ("VIP range", self.vip, self.supernet),
            ("system range", self.system, self.supernet),
            ("mesh range", self.mesh, self.system),
            ("DNS range", self.dns, self.system),
        ] {
            if !outer.covers(&range) {
                return Err(LayoutError::Outside { what, range, outer });
            }
        }
        for r in [self.vip, self.system] {
            if r.prefix_len() > SLICE_LEN {
                return Err(LayoutError::NotSliceAligned(r));
            }
        }
        if self.mesh.prefix_len() != 23 {
            return Err(LayoutError::MeshShape(self.mesh));
        }
        for (a, b) in [(self.vip, self.system), (self.mesh, self.dns)] {
            if a.overlaps(&b) {
                return Err(LayoutError::Overlap { a, b });
            }
        }
        Ok(())
    }

    /// The /25 holding one mesh generation's interface addresses.
    #[must_use]
    pub fn mesh_generation(&self, generation: MeshGeneration) -> Ipv4Net {
        let index = match generation {
            MeshGeneration::A => 0,
            MeshGeneration::B => 1,
        };
        // validate() guarantees a /23, so both /25s exist.
        self.mesh.subnet(25, index).unwrap_or(self.mesh)
    }

    /// The /24 holding each node's stable control address. Node-to-node control traffic uses
    /// these, routed through whichever generation's interface is current, so a key rotation
    /// moves it with the slice routes and the old interface drains.
    #[must_use]
    pub fn mesh_stable(&self) -> Ipv4Net {
        self.mesh.subnet(24, 1).unwrap_or(self.mesh)
    }

    /// Node slices in allocation order: every /19 of the supernet that is not reserved.
    pub fn slices(&self) -> impl Iterator<Item = Ipv4Net> + '_ {
        let count = u32::try_from(self.supernet.subnet_count(SLICE_LEN)).unwrap_or(u32::MAX);
        (0..count)
            .filter_map(|i| self.supernet.subnet(SLICE_LEN, i))
            .filter(|s| !s.overlaps(&self.vip) && !s.overlaps(&self.system))
    }
}

/// Usable endpoint addresses in a scope network of this prefix length:
/// everything except the network address, the bridge gateway (`.1`) and broadcast.
#[must_use]
pub fn usable_endpoints(len: u8) -> u64 {
    (1u64 << (32 - u32::from(len.min(30)))) - 3
}

/// Why an allocation was refused.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum IpamError {
    /// The node is already enrolled.
    #[error("node {0} already has slice {1}")]
    NodeExists(NodeId, Ipv4Net),
    /// The node is not enrolled.
    #[error("node {0} is not enrolled")]
    UnknownNode(NodeId),
    /// No free node slice and no free mesh ordinal.
    #[error(
        "no free node slice: {live} enrolled, {quarantined} slices awaiting peer acknowledgement"
    )]
    NoSlice {
        /// Live nodes.
        live: usize,
        /// Slices held in quarantine.
        quarantined: usize,
    },
    /// Scope size outside /24../27.
    #[error("scope size /{0} is not supported (use /{LARGEST_SCOPE_LEN} to /{UNIT_LEN})")]
    ScopeSize(u8),
    /// The scope already has a network on that node.
    #[error("scope {0} already has {1} on this node")]
    ScopeExists(ScopeId, Ipv4Net),
    /// The scope has no network on that node.
    #[error("scope {0} has no network on node {1}")]
    UnknownScope(ScopeId, NodeId),
    /// The node slice has no aligned run of free units of the requested size.
    #[error(
        "node {node} has no free /{len} (exhausted networks need a planned recreation, not growth)"
    )]
    SliceFull {
        /// Node.
        node: NodeId,
        /// Requested size.
        len: u8,
    },
    /// No free endpoint address in the scope network.
    #[error("{0} has no free endpoint address")]
    ScopeFull(Ipv4Net),
    /// The address is not a live endpoint in that network.
    #[error("{0} is not an allocated endpoint")]
    UnknownEndpoint(Ipv4Addr),
    /// The VIP range is used up; addresses are never reused.
    #[error("VIP range {0} is exhausted; reclaiming addresses needs a disruptive maintenance plan")]
    VipExhausted(Ipv4Net),
    /// The VIP already exists.
    #[error("VIP {0} already has {1}")]
    VipExists(VipId, Ipv4Addr),
    /// An external prefix collides with a live allocation or reserved range.
    #[error("{prefix} ({source_desc}) overlaps {with}; resolve the conflict before enrolling")]
    Conflict {
        /// The external prefix.
        prefix: Ipv4Net,
        /// Where it came from.
        source_desc: String,
        /// What it overlaps.
        with: Ipv4Net,
    },
    /// The quarantine entry does not exist.
    #[error("quarantine entry {0} does not exist")]
    UnknownQuarantine(u64),
}

/// A node's slice and mesh ordinal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeAlloc {
    /// The node's /19.
    pub slice: Ipv4Net,
    /// 1-based ordinal; the host part of the node's mesh address in either generation.
    pub ordinal: u8,
}

/// What a quarantine entry holds back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Held {
    /// A removed node's slice and mesh ordinal.
    NodeSlice {
        /// The slice.
        slice: Ipv4Net,
        /// The mesh ordinal.
        ordinal: u8,
    },
    /// A released scope network (its units).
    ScopeNetwork {
        /// The network.
        prefix: Ipv4Net,
    },
    /// A released endpoint address inside a live scope network.
    Endpoint {
        /// The scope network that contains it.
        network: Ipv4Net,
        /// The address.
        addr: Ipv4Addr,
    },
}

/// An address held until every forwarding peer has acknowledged cleanup.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Quarantine {
    /// Entry id, unique for the plan's lifetime.
    pub id: u64,
    /// What is held.
    pub held: Held,
    /// Peers that have not yet acknowledged (and are not fenced).
    pub awaiting: BTreeSet<NodeId>,
}

/// A prefix found in a node's inventory (existing bridge, route, VPN) that managed ranges must avoid.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct External {
    /// The prefix.
    pub prefix: Ipv4Net,
    /// Human-readable origin, e.g. `node-1: docker network "legacy" br-3f2a`.
    pub source: String,
}

/// The durable fleet address plan. The caller journals it after every successful mutation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddressPlan {
    layout: Layout,
    nodes: BTreeMap<NodeId, NodeAlloc>,
    scopes: BTreeMap<ScopeId, BTreeMap<NodeId, Ipv4Net>>,
    endpoints: BTreeMap<Ipv4Net, BTreeSet<Ipv4Addr>>,
    vips: BTreeMap<VipId, Ipv4Addr>,
    next_vip: u32,
    quarantine: Vec<Quarantine>,
    next_quarantine: u64,
    external: Vec<External>,
}

impl AddressPlan {
    /// An empty plan over a validated layout.
    ///
    /// # Errors
    /// [`LayoutError`] if the layout is unusable.
    pub fn new(layout: Layout) -> Result<Self, LayoutError> {
        layout.validate()?;
        Ok(Self {
            layout,
            nodes: BTreeMap::new(),
            scopes: BTreeMap::new(),
            endpoints: BTreeMap::new(),
            vips: BTreeMap::new(),
            // .0 is the network address of the VIP range; start at .1.
            next_vip: 1,
            quarantine: Vec::new(),
            next_quarantine: 1,
            external: Vec::new(),
        })
    }

    /// The layout.
    #[must_use]
    pub const fn layout(&self) -> &Layout {
        &self.layout
    }

    /// A node's allocation.
    #[must_use]
    pub fn node(&self, node: &NodeId) -> Option<NodeAlloc> {
        self.nodes.get(node).copied()
    }

    /// All live nodes.
    pub fn nodes(&self) -> impl Iterator<Item = (&NodeId, &NodeAlloc)> {
        self.nodes.iter()
    }

    /// A node's stable control address, independent of the mesh key generation.
    #[must_use]
    pub fn stable_mesh_address(&self, node: &NodeId) -> Option<Ipv4Addr> {
        let alloc = self.nodes.get(node)?;
        self.layout.mesh_stable().host(u32::from(alloc.ordinal))
    }

    /// A node's mesh interface address in one generation.
    #[must_use]
    pub fn mesh_address(&self, node: &NodeId, generation: MeshGeneration) -> Option<Ipv4Addr> {
        let alloc = self.nodes.get(node)?;
        self.layout
            .mesh_generation(generation)
            .host(u32::from(alloc.ordinal))
    }

    /// Every network of a scope, keyed by node: the scope's /27 units for the pair policy.
    #[must_use]
    pub fn scope_networks(&self, scope: &ScopeId) -> Option<&BTreeMap<NodeId, Ipv4Net>> {
        self.scopes.get(scope)
    }

    /// All scopes.
    pub fn scopes(&self) -> impl Iterator<Item = (&ScopeId, &BTreeMap<NodeId, Ipv4Net>)> {
        self.scopes.iter()
    }

    /// A VIP's address.
    #[must_use]
    pub fn vip(&self, vip: &VipId) -> Option<Ipv4Addr> {
        self.vips.get(vip).copied()
    }

    /// Open quarantine entries.
    #[must_use]
    pub fn quarantine(&self) -> &[Quarantine] {
        &self.quarantine
    }

    /// Records an inventory prefix that managed ranges must avoid.
    ///
    /// # Errors
    /// [`IpamError::Conflict`] if it overlaps the VIP or system range or a live or held allocation:
    /// the overlap must be resolved (migrated or re-planned) before cross-node routing.
    pub fn reserve_external(
        &mut self,
        prefix: Ipv4Net,
        source: impl Into<String>,
    ) -> Result<(), IpamError> {
        let source = source.into();
        let mut taken: Vec<Ipv4Net> = vec![self.layout.vip, self.layout.system];
        taken.extend(self.nodes.values().map(|n| n.slice));
        taken.extend(self.quarantine.iter().filter_map(|q| match q.held {
            Held::NodeSlice { slice, .. } => Some(slice),
            _ => None,
        }));
        if let Some(with) = taken.into_iter().find(|t| t.overlaps(&prefix)) {
            return Err(IpamError::Conflict {
                prefix,
                source_desc: source,
                with,
            });
        }
        if !self.external.iter().any(|e| e.prefix == prefix) {
            self.external.push(External { prefix, source });
        }
        Ok(())
    }

    /// Gives a node the lowest free slice and mesh ordinal.
    ///
    /// # Errors
    /// [`IpamError::NodeExists`], or [`IpamError::NoSlice`] when every slice is live, held or blocked.
    pub fn enroll_node(&mut self, node: NodeId) -> Result<NodeAlloc, IpamError> {
        if let Some(a) = self.nodes.get(&node) {
            return Err(IpamError::NodeExists(node, a.slice));
        }
        let held_slices: Vec<(Ipv4Net, u8)> = self
            .quarantine
            .iter()
            .filter_map(|q| match q.held {
                Held::NodeSlice { slice, ordinal } => Some((slice, ordinal)),
                _ => None,
            })
            .collect();
        let used_slice = |s: &Ipv4Net| {
            self.nodes.values().any(|n| n.slice == *s)
                || held_slices.iter().any(|(h, _)| h == s)
                || self.external.iter().any(|e| e.prefix.overlaps(s))
        };
        let slice = self.layout.slices().find(|s| !used_slice(s));
        let gen_capacity = u8::try_from(self.layout.mesh_generation(MeshGeneration::A).size() - 2)
            .unwrap_or(u8::MAX);
        let ordinal = (1..=gen_capacity).find(|o| {
            !self.nodes.values().any(|n| n.ordinal == *o)
                && !held_slices.iter().any(|(_, h)| h == o)
        });
        let (Some(slice), Some(ordinal)) = (slice, ordinal) else {
            return Err(IpamError::NoSlice {
                live: self.nodes.len(),
                quarantined: held_slices.len(),
            });
        };
        let alloc = NodeAlloc { slice, ordinal };
        self.nodes.insert(node, alloc);
        Ok(alloc)
    }

    /// Removes a node: its slice, ordinal and every scope network on it are held until all
    /// `forwarding_peers` acknowledge (the removed node itself never needs to).
    ///
    /// Returns the quarantine id, or `None` if no other peer can forward (the slice is free at once).
    ///
    /// # Errors
    /// [`IpamError::UnknownNode`].
    pub fn remove_node(
        &mut self,
        node: &NodeId,
        forwarding_peers: &BTreeSet<NodeId>,
    ) -> Result<Option<u64>, IpamError> {
        let alloc = self
            .nodes
            .remove(node)
            .ok_or_else(|| IpamError::UnknownNode(node.clone()))?;
        for nets in self.scopes.values_mut() {
            if let Some(net) = nets.remove(node) {
                self.endpoints.remove(&net);
            }
        }
        self.scopes.retain(|_, nets| !nets.is_empty());
        let mut awaiting = forwarding_peers.clone();
        awaiting.remove(node);
        Ok(self.hold(
            Held::NodeSlice {
                slice: alloc.slice,
                ordinal: alloc.ordinal,
            },
            awaiting,
        ))
    }

    /// Allocates a scope network of prefix length `len` (/24../27) on `node`, first fit, aligned.
    ///
    /// # Errors
    /// Unknown node, unsupported size, an existing network for this scope on the node, or a full slice.
    pub fn allocate_scope(
        &mut self,
        scope: ScopeId,
        node: &NodeId,
        len: u8,
    ) -> Result<Ipv4Net, IpamError> {
        if !(LARGEST_SCOPE_LEN..=UNIT_LEN).contains(&len) {
            return Err(IpamError::ScopeSize(len));
        }
        let alloc = self
            .nodes
            .get(node)
            .ok_or_else(|| IpamError::UnknownNode(node.clone()))?;
        if let Some(existing) = self.scopes.get(&scope).and_then(|n| n.get(node)) {
            return Err(IpamError::ScopeExists(scope, *existing));
        }
        let busy: Vec<Ipv4Net> = self
            .scopes
            .values()
            .filter_map(|n| n.get(node).copied())
            .chain(self.quarantine.iter().filter_map(|q| match q.held {
                Held::ScopeNetwork { prefix } => Some(prefix),
                _ => None,
            }))
            .chain(self.external.iter().map(|e| e.prefix))
            .collect();
        let count = u32::try_from(alloc.slice.subnet_count(len)).unwrap_or(0);
        let prefix = (0..count)
            .filter_map(|i| alloc.slice.subnet(len, i))
            .find(|c| !busy.iter().any(|b| b.overlaps(c)))
            .ok_or_else(|| IpamError::SliceFull {
                node: node.clone(),
                len,
            })?;
        self.scopes
            .entry(scope)
            .or_default()
            .insert(node.clone(), prefix);
        Ok(prefix)
    }

    /// Releases a scope's network on one node. Its addresses are held until all peers acknowledge.
    ///
    /// # Errors
    /// [`IpamError::UnknownScope`].
    pub fn release_scope(
        &mut self,
        scope: &ScopeId,
        node: &NodeId,
        forwarding_peers: &BTreeSet<NodeId>,
    ) -> Result<Option<u64>, IpamError> {
        let nets = self
            .scopes
            .get_mut(scope)
            .ok_or_else(|| IpamError::UnknownScope(scope.clone(), node.clone()))?;
        let prefix = nets
            .remove(node)
            .ok_or_else(|| IpamError::UnknownScope(scope.clone(), node.clone()))?;
        if nets.is_empty() {
            self.scopes.remove(scope);
        }
        self.endpoints.remove(&prefix);
        Ok(self.hold(Held::ScopeNetwork { prefix }, forwarding_peers.clone()))
    }

    /// Picks the lowest free endpoint address in a scope network (skipping `.0`, the gateway `.1`,
    /// broadcast, live and held addresses).
    ///
    /// # Errors
    /// [`IpamError::UnknownScope`] or [`IpamError::ScopeFull`].
    pub fn allocate_endpoint(
        &mut self,
        scope: &ScopeId,
        node: &NodeId,
    ) -> Result<Ipv4Addr, IpamError> {
        let network = *self
            .scopes
            .get(scope)
            .and_then(|n| n.get(node))
            .ok_or_else(|| IpamError::UnknownScope(scope.clone(), node.clone()))?;
        let held: BTreeSet<Ipv4Addr> = self
            .quarantine
            .iter()
            .filter_map(|q| match q.held {
                Held::Endpoint { network: n, addr } if n == network => Some(addr),
                _ => None,
            })
            .collect();
        let live = self.endpoints.entry(network).or_default();
        let last = u32::try_from(network.size() - 1).unwrap_or(0);
        let addr = (2..last)
            .filter_map(|h| network.host(h))
            .find(|a| !live.contains(a) && !held.contains(a))
            .ok_or(IpamError::ScopeFull(network))?;
        live.insert(addr);
        Ok(addr)
    }

    /// Releases an endpoint address; it is held until every forwarding peer acknowledges
    /// conntrack cleanup and observed policy withdrawal.
    ///
    /// # Errors
    /// [`IpamError::UnknownEndpoint`].
    pub fn release_endpoint(
        &mut self,
        addr: Ipv4Addr,
        forwarding_peers: &BTreeSet<NodeId>,
    ) -> Result<Option<u64>, IpamError> {
        let network = self
            .endpoints
            .iter_mut()
            .find_map(|(net, live)| live.remove(&addr).then_some(*net))
            .ok_or(IpamError::UnknownEndpoint(addr))?;
        Ok(self.hold(Held::Endpoint { network, addr }, forwarding_peers.clone()))
    }

    /// Assigns the next stable service address. VIPs are never reused, so this only moves forward.
    ///
    /// # Errors
    /// [`IpamError::VipExists`] or [`IpamError::VipExhausted`].
    pub fn allocate_vip(&mut self, vip: VipId) -> Result<Ipv4Addr, IpamError> {
        if let Some(a) = self.vips.get(&vip) {
            return Err(IpamError::VipExists(vip, *a));
        }
        let range = self.layout.vip;
        let last = u32::try_from(range.size() - 1).unwrap_or(0);
        if self.next_vip >= last {
            return Err(IpamError::VipExhausted(range));
        }
        let addr = range
            .host(self.next_vip)
            .ok_or(IpamError::VipExhausted(range))?;
        self.next_vip += 1;
        self.vips.insert(vip, addr);
        Ok(addr)
    }

    /// Deletes a VIP. Its address is retired, not freed.
    pub fn retire_vip(&mut self, vip: &VipId) -> Option<Ipv4Addr> {
        self.vips.remove(vip)
    }

    /// A peer reports cleanup done for one entry. Returns whether the entry is now released.
    ///
    /// # Errors
    /// [`IpamError::UnknownQuarantine`].
    pub fn acknowledge(&mut self, id: u64, peer: &NodeId) -> Result<bool, IpamError> {
        let entry = self
            .quarantine
            .iter_mut()
            .find(|q| q.id == id)
            .ok_or(IpamError::UnknownQuarantine(id))?;
        entry.awaiting.remove(peer);
        let done = entry.awaiting.is_empty();
        if done {
            self.quarantine.retain(|q| q.id != id);
        }
        Ok(done)
    }

    /// A peer is verifiably fenced from forwarding until it rejoins with current state
    /// (a CP-side "barred" flag is not enough). It no longer holds back any entry.
    /// Returns the ids released by this.
    pub fn peer_fenced(&mut self, peer: &NodeId) -> Vec<u64> {
        let mut released = Vec::new();
        for q in &mut self.quarantine {
            q.awaiting.remove(peer);
            if q.awaiting.is_empty() {
                released.push(q.id);
            }
        }
        self.quarantine.retain(|q| !q.awaiting.is_empty());
        released
    }

    fn hold(&mut self, held: Held, awaiting: BTreeSet<NodeId>) -> Option<u64> {
        if awaiting.is_empty() {
            return None;
        }
        let id = self.next_quarantine;
        self.next_quarantine += 1;
        self.quarantine.push(Quarantine { id, held, awaiting });
        Some(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn n(s: &str) -> NodeId {
        NodeId::new(s).unwrap()
    }

    fn peers(list: &[&str]) -> BTreeSet<NodeId> {
        list.iter().map(|s| n(s)).collect()
    }

    fn plan() -> AddressPlan {
        AddressPlan::new(Layout::default()).unwrap()
    }

    #[test]
    fn default_layout_leaves_room_for_55_nodes_and_reserves_first() {
        let l = Layout::default();
        l.validate().unwrap();
        assert_eq!(l.slices().count(), 64 - 8 - 1);
        assert!(
            l.slices()
                .all(|s| !s.overlaps(&l.vip) && !s.overlaps(&l.system))
        );
        assert_eq!(
            l.mesh_generation(MeshGeneration::A).to_string(),
            "172.30.224.0/25"
        );
        assert_eq!(
            l.mesh_generation(MeshGeneration::B).to_string(),
            "172.30.224.128/25"
        );
        assert_eq!(l.mesh_stable().to_string(), "172.30.225.0/24");
        assert!(
            !l.mesh_stable()
                .overlaps(&l.mesh_generation(MeshGeneration::B))
        );
    }

    #[test]
    fn layout_rejects_unaligned_or_overlapping_ranges() {
        let l = Layout {
            vip: "172.31.0.0/20".parse().unwrap(),
            ..Layout::default()
        };
        assert!(matches!(l.validate(), Err(LayoutError::NotSliceAligned(_))));
        let l = Layout {
            system: "172.31.0.0/19".parse().unwrap(),
            mesh: "172.31.0.0/23".parse().unwrap(),
            dns: "172.31.4.0/22".parse().unwrap(),
            ..Layout::default()
        };
        assert!(matches!(l.validate(), Err(LayoutError::Overlap { .. })));
        let l = Layout {
            mesh: "172.30.224.0/24".parse().unwrap(),
            ..Layout::default()
        };
        assert!(matches!(l.validate(), Err(LayoutError::MeshShape(_))));
    }

    #[test]
    fn nodes_get_distinct_slices_and_mesh_addresses_in_both_generations() {
        let mut p = plan();
        let a = p.enroll_node(n("w1")).unwrap();
        let b = p.enroll_node(n("w2")).unwrap();
        assert_eq!(a.slice.to_string(), "172.24.0.0/19");
        assert_eq!(b.slice.to_string(), "172.24.32.0/19");
        assert_eq!(
            p.mesh_address(&n("w2"), MeshGeneration::A),
            Some(Ipv4Addr::new(172, 30, 224, 2))
        );
        assert_eq!(
            p.mesh_address(&n("w2"), MeshGeneration::B),
            Some(Ipv4Addr::new(172, 30, 224, 130))
        );
        assert_eq!(
            p.stable_mesh_address(&n("w2")),
            Some(Ipv4Addr::new(172, 30, 225, 2))
        );
        assert!(matches!(
            p.enroll_node(n("w1")),
            Err(IpamError::NodeExists(..))
        ));
    }

    #[test]
    fn a_slash_24_consumes_eight_units_and_aligns() {
        let mut p = plan();
        p.enroll_node(n("w1")).unwrap();
        let s1 = p
            .allocate_scope(ScopeId::new("a").unwrap(), &n("w1"), 27)
            .unwrap();
        let s2 = p
            .allocate_scope(ScopeId::new("big").unwrap(), &n("w1"), 24)
            .unwrap();
        let s3 = p
            .allocate_scope(ScopeId::new("c").unwrap(), &n("w1"), 27)
            .unwrap();
        assert_eq!(s1.to_string(), "172.24.0.0/27");
        assert_eq!(s2.to_string(), "172.24.1.0/24");
        assert_eq!(s3.to_string(), "172.24.0.32/27");
        assert!(matches!(
            p.allocate_scope(ScopeId::new("x").unwrap(), &n("w1"), 23),
            Err(IpamError::ScopeSize(23))
        ));
        assert_eq!(usable_endpoints(27), 29);
    }

    #[test]
    fn released_scope_is_not_reused_until_every_forwarding_peer_acks() {
        let mut p = plan();
        p.enroll_node(n("w1")).unwrap();
        let first = p
            .allocate_scope(ScopeId::new("a").unwrap(), &n("w1"), 27)
            .unwrap();
        let q = p
            .release_scope(
                &ScopeId::new("a").unwrap(),
                &n("w1"),
                &peers(&["w1", "w2", "w3"]),
            )
            .unwrap()
            .unwrap();
        let other = p
            .allocate_scope(ScopeId::new("b").unwrap(), &n("w1"), 27)
            .unwrap();
        assert_ne!(other, first, "held while peers have not acked");
        assert!(!p.acknowledge(q, &n("w1")).unwrap());
        assert!(!p.acknowledge(q, &n("w2")).unwrap());
        // w3 is offline: it can only be fenced, never assumed.
        assert_eq!(p.peer_fenced(&n("w3")), vec![q]);
        assert_eq!(
            p.allocate_scope(ScopeId::new("c").unwrap(), &n("w1"), 27)
                .unwrap(),
            first
        );
    }

    #[test]
    fn endpoints_skip_gateway_and_wait_for_acks() {
        let mut p = plan();
        p.enroll_node(n("w1")).unwrap();
        p.allocate_scope(ScopeId::new("a").unwrap(), &n("w1"), 27)
            .unwrap();
        let e1 = p
            .allocate_endpoint(&ScopeId::new("a").unwrap(), &n("w1"))
            .unwrap();
        assert_eq!(e1, Ipv4Addr::new(172, 24, 0, 2));
        let q = p.release_endpoint(e1, &peers(&["w2"])).unwrap().unwrap();
        assert_eq!(
            p.allocate_endpoint(&ScopeId::new("a").unwrap(), &n("w1"))
                .unwrap(),
            Ipv4Addr::new(172, 24, 0, 3)
        );
        assert!(p.acknowledge(q, &n("w2")).unwrap());
        assert_eq!(
            p.allocate_endpoint(&ScopeId::new("a").unwrap(), &n("w1"))
                .unwrap(),
            e1
        );
        for _ in 0..27 {
            p.allocate_endpoint(&ScopeId::new("a").unwrap(), &n("w1"))
                .unwrap();
        }
        assert!(matches!(
            p.allocate_endpoint(&ScopeId::new("a").unwrap(), &n("w1")),
            Err(IpamError::ScopeFull(_))
        ));
    }

    #[test]
    fn removed_node_slice_and_ordinal_are_held() {
        let mut p = plan();
        let w1 = p.enroll_node(n("w1")).unwrap();
        p.enroll_node(n("w2")).unwrap();
        p.allocate_scope(ScopeId::new("a").unwrap(), &n("w1"), 27)
            .unwrap();
        let held = p
            .remove_node(&n("w1"), &peers(&["w1", "w2"]))
            .unwrap()
            .unwrap();
        assert!(p.scope_networks(&ScopeId::new("a").unwrap()).is_none());
        let w3 = p.enroll_node(n("w3")).unwrap();
        assert_ne!(w3.slice, w1.slice);
        assert_ne!(w3.ordinal, w1.ordinal);
        assert!(p.acknowledge(held, &n("w2")).unwrap());
        let w4 = p.enroll_node(n("w4")).unwrap();
        assert_eq!((w4.slice, w4.ordinal), (w1.slice, w1.ordinal));
    }

    #[test]
    fn vips_only_move_forward() {
        let mut p = plan();
        let v1 = p.allocate_vip(VipId::new("api").unwrap()).unwrap();
        assert_eq!(v1, Ipv4Addr::new(172, 31, 0, 1));
        p.retire_vip(&VipId::new("api").unwrap());
        let v2 = p.allocate_vip(VipId::new("api").unwrap()).unwrap();
        assert_ne!(v1, v2);
    }

    #[test]
    fn external_conflicts_block_and_are_avoided() {
        let mut p = plan();
        p.enroll_node(n("w1")).unwrap();
        let err = p
            .reserve_external(
                "172.24.4.0/24".parse().unwrap(),
                "w1: docker network legacy",
            )
            .unwrap_err();
        assert!(matches!(err, IpamError::Conflict { .. }));
        p.reserve_external("172.24.32.0/20".parse().unwrap(), "w2: vpn route")
            .unwrap();
        let b = p.enroll_node(n("w2")).unwrap();
        assert_eq!(b.slice.to_string(), "172.24.64.0/19");
    }

    #[test]
    fn plan_round_trips_through_json() {
        let mut p = plan();
        p.enroll_node(n("w1")).unwrap();
        p.allocate_scope(ScopeId::new("a").unwrap(), &n("w1"), 26)
            .unwrap();
        p.allocate_vip(VipId::new("v").unwrap()).unwrap();
        p.release_scope(&ScopeId::new("a").unwrap(), &n("w1"), &peers(&["w2"]))
            .unwrap();
        let text = serde_json::to_string(&p).unwrap();
        assert_eq!(serde_json::from_str::<AddressPlan>(&text).unwrap(), p);
    }

    #[derive(Debug, Clone)]
    enum Op {
        Alloc(u8, u8),
        Release(u8),
        Ack(u8),
        Fence(u8),
    }

    fn op() -> impl Strategy<Value = Op> {
        prop_oneof![
            (
                0u8..12,
                prop_oneof![Just(27u8), Just(26), Just(25), Just(24)]
            )
                .prop_map(|(s, l)| Op::Alloc(s, l)),
            (0u8..12).prop_map(Op::Release),
            (0u8..3).prop_map(Op::Ack),
            (0u8..3).prop_map(Op::Fence),
        ]
    }

    proptest! {
        /// No live network overlaps another, and no live network overlaps an address
        /// still held for an unacknowledged peer.
        #[test]
        fn live_scopes_never_overlap_each_other_or_held_ranges(ops in proptest::collection::vec(op(), 1..80)) {
            let mut p = plan();
            p.enroll_node(n("w1")).unwrap();
            let fwd = peers(&["p0", "p1", "p2"]);
            for o in ops {
                match o {
                    Op::Alloc(s, l) => { let _ = p.allocate_scope(ScopeId::new(format!("s{s}")).unwrap(), &n("w1"), l); }
                    Op::Release(s) => { let _ = p.release_scope(&ScopeId::new(format!("s{s}")).unwrap(), &n("w1"), &fwd); }
                    Op::Ack(i) => {
                        let ids: Vec<u64> = p.quarantine().iter().map(|q| q.id).collect();
                        for id in ids { let _ = p.acknowledge(id, &n(&format!("p{i}"))); }
                    }
                    Op::Fence(i) => { p.peer_fenced(&n(&format!("p{i}"))); }
                }
                let live: Vec<Ipv4Net> = p.scopes().filter_map(|(_, m)| m.get(&n("w1")).copied()).collect();
                for (i, a) in live.iter().enumerate() {
                    for b in &live[i + 1..] { prop_assert!(!a.overlaps(b), "{a} overlaps {b}"); }
                    for q in p.quarantine() {
                        if let Held::ScopeNetwork { prefix } = q.held { prop_assert!(!a.overlaps(&prefix), "{a} reuses held {prefix}"); }
                    }
                }
            }
        }
    }
}
