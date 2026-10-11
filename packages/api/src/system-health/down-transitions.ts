/**
 * Which absences to announce, and which to announce as over.
 *
 * The pure half of the down watch (down-watch.ts holds the DB/docker reads and
 * the Redis state). Given what was missing last tick and what is missing now,
 * decide what to notify and what to clear. Modelled on pressure-transitions.ts
 * for the same reason: a tick is not an event, and an operator must be told
 * once when a thing breaks, reminded if it is still broken much later, and
 * told when it comes back.
 *
 * The grace window is the part that earns its keep. A redeploy legitimately
 * has no container for a few seconds, and a slow image pull for longer, so a
 * resource has to be missing across the whole window before it counts as down.
 * `missingSince` is carried in the persisted state rather than a tick counter
 * so a control-plane restart mid-window doesn't restart the clock — the
 * failure this whole watch exists to catch went unnoticed for two days, and
 * "we forgot because we restarted" is exactly how that happens again.
 */
import type { OrganizationId } from "@otterdeploy/shared/id";

import * as z from "zod";

/** One resource observed as expected-but-absent this tick. */
export interface MissingResource {
  resourceId: string;
  /** `stack / service` for a compose member, else the resource name. */
  label: string;
  projectSlug: string;
  projectName: string;
  organizationId: OrganizationId;
  kind: "service" | "database";
}

/** Persisted per resource: when it went missing, and when (if ever) we said so. */
export const activeDownSchema = z.record(
  z.string(),
  z.object({
    missingSince: z.number(),
    /** Null while still inside the grace window: seen, not yet announced. */
    notifiedAt: z.number().nullable(),
    label: z.string(),
  }),
);
export type ActiveDown = z.infer<typeof activeDownSchema>;

export interface DownPlan {
  /** Announce as down now, with how long it has been down. */
  notify: Array<{ resource: MissingResource; downForMs: number; reminder: boolean }>;
  /** Announced down earlier, running again now. */
  recovered: Array<{ resourceId: string; label: string; downForMs: number }>;
  next: ActiveDown;
}

export function planDownTransitions(input: {
  active: ActiveDown;
  missing: readonly MissingResource[];
  now: number;
  /** Missing for at least this long before it is called down. */
  graceMs: number;
  /** Re-announce a still-down resource after this long. */
  remindAfterMs: number;
}): DownPlan {
  const next: ActiveDown = {};
  const notify: DownPlan["notify"] = [];

  for (const resource of input.missing) {
    const prior = input.active[resource.resourceId];
    const missingSince = prior?.missingSince ?? input.now;
    const downForMs = input.now - missingSince;
    const priorNotifiedAt = prior?.notifiedAt ?? null;

    const dueForFirst = priorNotifiedAt === null && downForMs >= input.graceMs;
    const dueForReminder =
      priorNotifiedAt !== null && input.now - priorNotifiedAt >= input.remindAfterMs;

    if (dueForFirst || dueForReminder) {
      notify.push({ resource, downForMs, reminder: dueForReminder });
      next[resource.resourceId] = { missingSince, notifiedAt: input.now, label: resource.label };
    } else {
      next[resource.resourceId] = {
        missingSince,
        notifiedAt: priorNotifiedAt,
        label: resource.label,
      };
    }
  }

  const missingIds = new Set(input.missing.map((r) => r.resourceId));
  const recovered = Object.entries(input.active)
    // A resource that never got past the grace window was never announced, so
    // there is nothing to close. Recovering from an unannounced blip must not
    // produce a lone "back up" for an outage nobody was told about.
    .filter(([id, entry]) => !missingIds.has(id) && entry.notifiedAt !== null)
    .map(([id, entry]) => ({
      resourceId: id,
      label: entry.label,
      downForMs: input.now - entry.missingSince,
    }));

  return { notify, recovered, next };
}
