/**
 * Rollout bookkeeping per service: how many slots are between revisions (for
 * `update.parallelism`), the failure ratio, and the completion or failure
 * outcome. A candidate is healthy only after running for `update.monitorMs`.
 */
import type { GrantView, ServiceView } from "../model";
import type { Pass } from "./pass";

export const healthy = (g: GrantView, monitorMs: number, now: number): boolean =>
  !g.failed && g.runningSince !== null && now - g.runningSince >= monitorMs;

export interface RolloutBudget {
  /** Slots of this service currently between revisions. */
  updating: number;
  failed: number;
  attempted: number;
}

export function rolloutBudget(
  svc: ServiceView,
  grants: readonly GrantView[],
  now: number,
): RolloutBudget {
  const bySlot = new Map<number, GrantView[]>();
  for (const g of grants) {
    if (g.resourceId !== svc.resourceId || g.orphan || g.state === "released") continue;
    bySlot.set(g.slotIndex, [...(bySlot.get(g.slotIndex) ?? []), g]);
  }
  const budget: RolloutBudget = { updating: 0, failed: 0, attempted: 0 };
  for (const gs of bySlot.values()) {
    const fresh = gs.filter((g) => g.specRevision === svc.revision);
    const old = gs.filter((g) => g.specRevision < svc.revision);
    if (fresh.length > 0) budget.attempted++;
    if (fresh.some((g) => g.failed)) budget.failed++;
    const settled =
      old.length === 0 && fresh.every((g) => healthy(g, svc.spec.update.monitorMs, now));
    if (!settled && (fresh.length > 0 || old.some((g) => g.stopRequested))) budget.updating++;
  }
  return budget;
}

function failureOutcome(p: Pass, svc: ServiceView, budget: RolloutBudget): boolean {
  const u = svc.spec.update;
  const over =
    budget.attempted > 0 && budget.failed * 1000 > u.maxFailureRatioPermille * budget.attempted;
  if (!over) return false;
  if (u.failureAction === "pause" && !svc.rolloutPaused) {
    p.actions.push({
      kind: "rollout",
      resourceId: svc.resourceId,
      outcome: "paused",
      revision: svc.revision,
    });
    return true;
  }
  if (u.failureAction === "rollback" && svc.stableRevision !== null) {
    p.actions.push({
      kind: "rollout",
      resourceId: svc.resourceId,
      outcome: "rollback",
      revision: svc.stableRevision,
    });
    return true;
  }
  return false;
}

/** Completion and failure policy, once per service per pass. */
export function rolloutOutcome(
  p: Pass,
  svc: ServiceView,
  desired: ReadonlyMap<number, string | undefined>,
  budget: RolloutBudget,
): void {
  if (svc.paused || svc.stableRevision === svc.revision) return;
  if (failureOutcome(p, svc, budget)) return;
  for (const idx of desired.keys()) {
    const gs = p.working.filter(
      (g) =>
        g.resourceId === svc.resourceId &&
        g.slotIndex === idx &&
        g.state !== "released" &&
        !g.orphan,
    );
    const g = gs.length === 1 ? gs[0] : undefined;
    if (!g || g.specRevision !== svc.revision || !healthy(g, svc.spec.update.monitorMs, p.s.now))
      return;
  }
  p.actions.push({
    kind: "rollout",
    resourceId: svc.resourceId,
    outcome: "completed",
    revision: svc.revision,
  });
}
