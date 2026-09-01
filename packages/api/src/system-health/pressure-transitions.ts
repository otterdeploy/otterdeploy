/**
 * Which pressure recommendations to announce, and which to announce as over.
 *
 * The monitor used to emit every warning/critical recommendation not "under
 * cooldown", with the cooldown in a process-local Map. Every restart forgot
 * it, so a box sitting at 92% memory produced a fresh unread row per restart
 * (in dev, per `--hot` reload — the owner's inbox held seventy of them), and
 * nothing ever said the condition had ended.
 *
 * This is the pure half of the fix: given what was active last tick and what
 * is urgent now, decide what to notify (newly active, or active past the
 * reminder window) and what to clear (active, no longer urgent). The other
 * half persists `active` outside the process (monitor.ts).
 */
import * as z from "zod";

import type { HealthRecommendation } from "./host-health";

/** One active recommendation as persisted: when it was last announced, and
 *  the title it was announced with, so the clear can name it. */
export const activePressureSchema = z.record(
  z.string(),
  z.object({ notifiedAt: z.number(), title: z.string() }),
);
export type ActivePressure = z.infer<typeof activePressureSchema>;

export interface PressurePlan {
  notify: HealthRecommendation[];
  /** Recommendation ids that were active and are not urgent any more. */
  clear: Array<{ id: string; title: string }>;
  next: ActivePressure;
}

export function planPressureTransitions(input: {
  active: ActivePressure;
  urgent: readonly HealthRecommendation[];
  now: number;
  /** Re-announce a still-active condition after this long. */
  remindAfterMs: number;
}): PressurePlan {
  const next: ActivePressure = {};
  const notify: HealthRecommendation[] = [];
  const urgentIds = new Set(input.urgent.map((r) => r.id));

  for (const rec of input.urgent) {
    const prior = input.active[rec.id];
    if (!prior || input.now - prior.notifiedAt >= input.remindAfterMs) {
      notify.push(rec);
      next[rec.id] = { notifiedAt: input.now, title: rec.title };
    } else {
      next[rec.id] = prior;
    }
  }

  const clear = Object.entries(input.active)
    .filter(([id]) => !urgentIds.has(id))
    .map(([id, entry]) => ({ id, title: entry.title }));

  return { notify, clear, next };
}

/** What the clear event is called. Named for the recovery, not the alarm. */
export function clearedTitle(recommendationId: string, title: string): string {
  switch (recommendationId) {
    case "memory-critical":
      return "Server memory recovered";
    case "disk-pressure":
      return "Disk pressure cleared";
    case "images-reclaimable":
      return "Unused images cleaned up";
    case "build-cache-reclaimable":
      return "Idle build cache cleared";
    case "branch-pool-unhealthy":
    case "branch-pool-capacity":
    case "branch-pool-reclaimable":
      return "Branching pool healthy again";
    case "no-swap":
      return "Swap configured";
    default:
      return `${title} — cleared`;
  }
}
