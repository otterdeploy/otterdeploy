/**
 * Failover of a slot whose every copy is on a node that is not ready.
 *
 * Nothing moves while the node is only suspect, for `stay`, for a global slot,
 * or before the per-service delay measured from the node's last evidence (a
 * longer delay always wins). After it, a shared copy is revoked, marked
 * orphan-possible (still counted on its node) and replaced elsewhere, unless
 * fresh peer evidence says the node is only partitioned. An exclusive copy is
 * revoked and waits for positive retirement: the node's fence when an install
 * admin enabled one, otherwise it stays blocked. Silence is never a stop.
 */
import type { GrantView, NodeView, ServiceView } from "../model";
import type { Pass } from "./pass";

import { failoverDelayMs } from "./types";

function exclusiveFailover(
  p: Pass,
  svc: ServiceView,
  slotIndex: number,
  node: NodeView,
  current: GrantView[],
): void {
  for (const c of current) p.revoke(c, "node down past the failover delay");
  if (node.fencing) {
    p.pending(svc, slotIndex, { code: "fencing", nodeId: node.nodeId });
  } else if (node.fence?.enabled) {
    p.fence(node, `exclusive slot ${svc.resourceId}#${slotIndex} needs positive retirement`);
    p.pending(svc, slotIndex, { code: "fencing", nodeId: node.nodeId });
  } else {
    p.pending(svc, slotIndex, { code: "fence-required", nodeId: node.nodeId });
  }
}

function sharedFailover(
  p: Pass,
  svc: ServiceView,
  slotIndex: number,
  node: NodeView,
  current: GrantView[],
): void {
  const now = p.s.now;
  if (node.peerFreshUntil !== null && node.peerFreshUntil > now) {
    p.pending(svc, slotIndex, {
      code: "partitioned",
      nodeId: node.nodeId,
      until: node.peerFreshUntil,
    });
    return;
  }
  for (const c of current) {
    p.revoke(c, "node down past the failover delay");
    c.orphan = true;
    p.actions.push({
      kind: "orphan",
      grantId: c.grantId,
      reason: "replaced after the failover delay",
    });
  }
  p.issue(svc, slotIndex, {
    surge: false,
    exclude: current.map((c) => c.nodeId),
    reason: `failover from ${node.nodeId}`,
  });
}

export function failover(p: Pass, svc: ServiceView, slotIndex: number, current: GrantView[]): void {
  const spec = svc.spec;
  const g = current.reduce((a, b) => (b.generation > a.generation ? b : a));
  const node = p.nodes.get(g.nodeId);
  if (!node || p.liveness(g.nodeId) === "suspect") {
    p.pending(svc, slotIndex, { code: "node-suspect", nodeId: g.nodeId });
    return;
  }
  if (spec.lifecycle.failover.policy === "stay" || spec.mode.kind === "global") {
    p.pending(svc, slotIndex, { code: "node-down", nodeId: g.nodeId });
    return;
  }
  const since = node.lastEvidenceAt ?? g.sentAt ?? p.s.now;
  const until = since + failoverDelayMs(spec);
  if (p.s.now < until) {
    p.pending(svc, slotIndex, { code: "failover-delay", nodeId: g.nodeId, until });
    return;
  }
  if (spec.lifecycle.exclusive) exclusiveFailover(p, svc, slotIndex, node, current);
  else sharedFailover(p, svc, slotIndex, node, current);
}
