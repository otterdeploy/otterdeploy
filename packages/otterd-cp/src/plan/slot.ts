import type { GrantView, ServiceView } from "../model";
import type { Pass } from "./pass";
import type { RolloutBudget } from "./rollout";

/**
 * One slot of one service: release what is retired, stop stale copies, then
 * fill an empty slot, fail over a slot whose copy is on a down node, or move
 * a healthy slot forward (re-bind, drain, rollout).
 */
import { mayRelease } from "../admission";
import { failover } from "./failover";
import { progress } from "./progress";
import { evacuating } from "./types";

/** 1. Release every grant with verified positive retirement; return the rest. */
function releaseRetired(p: Pass, svc: ServiceView, slotIndex: number): GrantView[] {
  const live: GrantView[] = [];
  for (const g of p.working) {
    if (g.resourceId !== svc.resourceId || g.slotIndex !== slotIndex || g.state === "released") {
      continue;
    }
    const r = p.retirements.get(g.grantId) ?? null;
    if (mayRelease(g, r).isOk()) p.release(g, r);
    else live.push(g);
  }
  return live;
}

/**
 * 2. Stop stale copies where the node can answer. After a node restart, boot
 * quarantine stops and certifies exclusive grants; the stop collects the
 * certificate. Shared grants keep running and are re-bound in `progress`.
 */
function stopStale(p: Pass, live: readonly GrantView[], exclusive: boolean, wanted: boolean): void {
  for (const g of live) {
    if (p.restarted(g)) {
      if (exclusive || g.orphan || !wanted) p.stop(g, "node restarted: boot quarantine");
    } else if (p.liveness(g.nodeId) !== "ready") {
      continue;
    } else if (g.orphan) {
      p.stop(g, "superseded copy on a rejoined node");
    } else if (!wanted) {
      p.stop(g, "no longer desired");
    }
  }
}

function settleUnwanted(p: Pass, svc: ServiceView, slotIndex: number, live: GrantView[]): void {
  for (const g of live) if (p.liveness(g.nodeId) === "down") p.revoke(g, "no longer desired");
  if (live.length > 0) {
    p.pending(svc, slotIndex, { code: "awaiting-stop", grantIds: live.map((g) => g.grantId) });
  }
}

function fillEmpty(
  p: Pass,
  svc: ServiceView,
  slotIndex: number,
  live: GrantView[],
  pinned: string | undefined,
): void {
  const exclusive = svc.spec.lifecycle.exclusive;
  if (exclusive && live.length > 0) {
    p.pending(svc, slotIndex, { code: "awaiting-stop", grantIds: live.map((g) => g.grantId) });
    return;
  }
  const pinnedNode = pinned === undefined ? undefined : p.nodes.get(pinned);
  if (pinnedNode && evacuating(pinnedNode, exclusive)) {
    p.pending(svc, slotIndex, { code: "node-draining", nodeId: pinnedNode.nodeId });
    return;
  }
  p.issue(svc, slotIndex, {
    surge: false,
    ...(pinned === undefined ? {} : { pinned }),
    reason: "slot has no grant",
  });
}

export function planSlot(
  p: Pass,
  svc: ServiceView,
  slotIndex: number,
  wanted: boolean,
  pinned: string | undefined,
  budget: RolloutBudget,
): void {
  const exclusive = svc.spec.lifecycle.exclusive;
  const live = releaseRetired(p, svc, slotIndex);
  stopStale(p, live, exclusive, wanted);
  if (!wanted) {
    settleUnwanted(p, svc, slotIndex, live);
    return;
  }
  const quarantined = live.filter((g) => !g.orphan && exclusive && p.restarted(g));
  if (quarantined.length > 0) {
    p.pending(svc, slotIndex, {
      code: "awaiting-stop",
      grantIds: quarantined.map((g) => g.grantId),
    });
    return;
  }
  const current = live.filter((g) => !g.orphan);
  if (current.length === 0) {
    fillEmpty(p, svc, slotIndex, live, pinned);
    return;
  }
  const responsive = current.filter((g) => p.liveness(g.nodeId) === "ready");
  if (responsive.length === 0) {
    failover(p, svc, slotIndex, current);
    return;
  }
  progress(p, svc, slotIndex, responsive, pinned, budget);
}
