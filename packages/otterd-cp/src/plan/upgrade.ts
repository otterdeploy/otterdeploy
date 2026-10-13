/**
 * Rolling otterd upgrade, one node at a time. An otterd restart is a new
 * incarnation: boot quarantine stops and certifies exclusive grants, shared
 * grants ride through and are re-bound. So: drain exclusive work (the node is
 * cordoned; movable exclusive slots move stop-first, pinned ones stop) →
 * upgrade once no exclusive grant is left → rejoining (a new incarnation
 * connected) → done (ready again; pinned exclusive slots are re-issued).
 */
import type { NodeView } from "../model";
import type { Pass } from "./pass";

const IN_FLIGHT = new Set(["draining", "upgrading", "rejoining"]);

function advance(p: Pass, n: NodeView): void {
  const u = n.upgrade;
  if (!u) return;
  if (u.phase === "draining") {
    const held = p.working.some(
      (g) => g.nodeId === n.nodeId && g.state !== "released" && !g.orphan && g.exclusive,
    );
    if (!held && p.liveness(n.nodeId) === "ready") {
      p.actions.push({ kind: "upgrade-phase", nodeId: n.nodeId, phase: "upgrading" });
    }
  } else if (u.phase === "upgrading") {
    if (n.connected && n.incarnation !== null && n.incarnation !== u.fromIncarnation) {
      p.actions.push({ kind: "upgrade-phase", nodeId: n.nodeId, phase: "rejoining" });
    }
  } else if (u.phase === "rejoining" && p.liveness(n.nodeId) === "ready") {
    p.actions.push({ kind: "upgrade-phase", nodeId: n.nodeId, phase: "done" });
  }
}

export function planUpgrades(p: Pass): void {
  const inFlight = p.s.nodes.filter((n) => n.upgrade && IN_FLIGHT.has(n.upgrade.phase));
  for (const n of inFlight) advance(p, n);
  if (inFlight.length > 0) return;
  const next = p.s.nodes
    .filter((n) => n.upgrade?.phase === "queued")
    .sort((a, b) => a.ordinal - b.ordinal)[0];
  if (next) p.actions.push({ kind: "upgrade-phase", nodeId: next.nodeId, phase: "draining" });
}
