/**
 * The scheduler's reconcile pass: from one snapshot to an ordered list of
 * actions. Pure and deterministic; the executor applies the actions through
 * the store, whose transactions re-check every rule here.
 *
 * Per slot, in order:
 *
 * 1. **Release** every grant with verified positive retirement (or a Prepared
 *    grant that never left the control plane).
 * 2. **Stop stale copies** where the node can answer: orphan-possible shared
 *    copies, exclusive grants of an earlier node incarnation (boot quarantine
 *    stopped them; the stop collects the certificate), unwanted grants.
 * 3. **Failover** when every copy is on a node that is not ready (failover.ts).
 * 4. **Restart, drain and upgrade** (progress.ts, upgrade.ts): shared grants
 *    that survived a node restart are re-bound start-first on the same node;
 *    a drain moves movable copies off and stops pinned ones; an otterd upgrade
 *    drains only exclusive work, one node at a time.
 * 5. **Rollout** of a newer revision per `update` (progress.ts, rollout.ts).
 *    Exclusive slots and fixed host ports are always stop-first.
 */
import type { NodeView, ServiceView, Snapshot } from "../model";
import type { Action } from "./types";

import { globalNodes } from "../placement";
import { Pass } from "./pass";
import { rolloutBudget, rolloutOutcome } from "./rollout";
import { planSlot } from "./slot";
import { planUpgrades } from "./upgrade";

export type { Action, PendingReason } from "./types";
export { effectiveOrder, evacuating, failoverDelayMs } from "./types";

/** Desired slots of a service: index → the node it is pinned to, if any. */
function desiredSlots(
  svc: ServiceView,
  nodes: readonly NodeView[],
): Map<number, string | undefined> {
  const out = new Map<number, string | undefined>();
  if (svc.paused) return out;
  const mode = svc.spec.mode;
  const stay = svc.spec.lifecycle.failover.policy === "stay";
  const home = stay && svc.homeNode !== null ? svc.homeNode : undefined;
  if (mode.kind === "replicated") {
    for (let i = 0; i < mode.replicas; i++) out.set(i, home);
  } else if (mode.kind === "global") {
    for (const n of globalNodes(svc.spec, nodes)) out.set(n.ordinal, n.nodeId);
  }
  return out;
}

function planService(p: Pass, svc: ServiceView): void {
  if (svc.spec.mode.kind === "job") {
    p.pending(svc, 0, { code: "unsupported-mode", mode: "job" });
    return;
  }
  const desired = desiredSlots(svc, p.s.nodes);
  const slots = new Set<number>(desired.keys());
  for (const g of p.working) {
    if (g.resourceId === svc.resourceId && g.state !== "released") slots.add(g.slotIndex);
  }
  const budget = rolloutBudget(svc, p.working, p.s.now);
  for (const idx of [...slots].sort((a, b) => a - b)) {
    planSlot(p, svc, idx, desired.has(idx), desired.get(idx), budget);
  }
  rolloutOutcome(p, svc, desired, budget);
}

export function plan(s: Snapshot): Action[] {
  const p = new Pass(s);
  const services = [...s.services].sort((a, b) => (a.resourceId < b.resourceId ? -1 : 1));
  for (const svc of services) planService(p, svc);
  planUpgrades(p);
  return p.actions;
}
