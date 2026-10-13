/**
 * A slot with a copy on a ready node: finish a start-first handover, re-bind
 * a shared grant that survived a node restart, empty a draining node, or roll
 * the slot forward to the service's revision.
 */
import type { GrantView, NodeView, ServiceView } from "../model";
import type { Pass } from "./pass";

import { type RolloutBudget, healthy } from "./rollout";
import { effectiveOrder, evacuating } from "./types";

interface SlotContext {
  p: Pass;
  svc: ServiceView;
  slotIndex: number;
  pinned: string | undefined;
}

/** A surge beside the incumbent: hand over once it is healthy. */
function handover(
  c: SlotContext,
  inc: GrantView,
  surge: GrantView,
  why: "rebind" | "drain" | "update",
): void {
  const { p, svc, slotIndex } = c;
  if (surge.specRevision !== svc.revision && why === "update") {
    p.stop(surge, "candidate of an older revision");
  } else if (healthy(surge, svc.spec.update.monitorMs, p.s.now)) {
    const reason = {
      rebind: "re-bound after a node restart",
      drain: "moved off a draining node",
      update: "replaced by a start-first candidate",
    }[why];
    p.stop(inc, reason);
  } else if (surge.failed) {
    p.stop(surge, "start-first candidate failed");
  } else {
    p.pending(svc, slotIndex, { code: "rollout-waiting", until: null });
  }
}

/**
 * A shared grant of an earlier incarnation keeps running but can start
 * nothing new: re-bind it with a fresh grant on the same node, start-first,
 * so the restart costs no gap. Elsewhere only if the node cannot take it.
 */
function rebind(c: SlotContext, node: NodeView): void {
  const reason = "re-bind after a node restart";
  const opts = { surge: true, pinned: node.nodeId, reason, quiet: true, rebind: true };
  if (!c.p.issue(c.svc, c.slotIndex, opts)) c.p.issue(c.svc, c.slotIndex, { surge: true, reason });
}

function drain(c: SlotContext, inc: GrantView, node: NodeView): void {
  const { p, svc, slotIndex, pinned } = c;
  const spec = svc.spec;
  const movable =
    spec.lifecycle.failover.policy === "reschedule" &&
    spec.mode.kind === "replicated" &&
    pinned === undefined;
  if (inc.stopRequested) {
    p.pending(svc, slotIndex, { code: "awaiting-stop", grantIds: [inc.grantId] });
  } else if (!movable) {
    p.stop(inc, "node draining: pinned copy stops and returns after the node rejoins");
  } else if (effectiveOrder(spec) === "start-first") {
    p.issue(svc, slotIndex, {
      surge: true,
      exclude: [node.nodeId],
      reason: `drain ${node.nodeId}`,
    });
  } else {
    p.stop(inc, `drain ${node.nodeId}: stop-first move`);
  }
}

function update(c: SlotContext, inc: GrantView, budget: RolloutBudget): void {
  const { p, svc, slotIndex, pinned } = c;
  const spec = svc.spec;
  if (inc.stopRequested) {
    p.pending(svc, slotIndex, { code: "awaiting-stop", grantIds: [inc.grantId] });
    return;
  }
  if (svc.rolloutPaused) {
    p.pending(svc, slotIndex, { code: "rollout-paused" });
    return;
  }
  const { parallelism, delayMs } = spec.update;
  if (parallelism > 0 && budget.updating >= parallelism) {
    p.pending(svc, slotIndex, { code: "rollout-waiting", until: null });
    return;
  }
  if (svc.lastSlotUpdatedAt !== null && p.s.now < svc.lastSlotUpdatedAt + delayMs) {
    p.pending(svc, slotIndex, { code: "rollout-waiting", until: svc.lastSlotUpdatedAt + delayMs });
    return;
  }
  budget.updating++;
  if (effectiveOrder(spec) === "start-first") {
    p.issue(svc, slotIndex, {
      surge: true,
      ...(pinned === undefined ? {} : { pinned }),
      reason: `update to revision ${svc.revision} (start-first)`,
    });
  } else {
    p.stop(inc, `update to revision ${svc.revision} (stop-first)`);
  }
}

export function progress(
  p: Pass,
  svc: ServiceView,
  slotIndex: number,
  responsive: GrantView[],
  pinned: string | undefined,
  budget: RolloutBudget,
): void {
  const c: SlotContext = { p, svc, slotIndex, pinned };
  const incumbents = responsive.filter((g) => !g.surge);
  const inc = incumbents[0] ?? responsive[0];
  if (!inc) return;
  const surge = incumbents.length > 0 ? responsive.find((g) => g.surge) : undefined;
  const node = p.nodes.get(inc.nodeId);
  if (!node) return;
  const draining = evacuating(node, svc.spec.lifecycle.exclusive);
  const restarted = p.restarted(inc);
  if (surge) handover(c, inc, surge, restarted ? "rebind" : draining ? "drain" : "update");
  else if (restarted) rebind(c, node);
  else if (draining) drain(c, inc, node);
  else if (inc.specRevision < svc.revision) update(c, inc, budget);
}
