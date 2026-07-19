/**
 * Orphaned-resource garbage collection.
 *
 * When a resource is deleted but its remote runtime object can't be torn down
 * (the Docker daemon was unreachable, or a best-effort teardown swallowed the
 * failure), the object leaks: the DB row is gone but the swarm service /
 * container / volume / network / image lingers. `recordOrphanedResource` writes
 * a work-list row (schema/orphaned-resource.ts); this sweep retries the real
 * teardown primitive idempotently, deleting the row once the object is gone and
 * bumping `attempts`/`lastAttemptAt` (with exponential backoff) when it isn't.
 *
 * This is the Docker-object analogue of the data-folder sweep (which reclaims
 * leaked host dirs). Unlike a blind label-diff sweep it only ever destroys
 * objects an explicit delete already recorded, so it can't race an in-flight
 * create.
 */
import type { OrganizationId, ProjectId, ResourceId, ServerId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { orphanedResource } from "@otterdeploy/db/schema";
import { asc, eq } from "drizzle-orm";
import { log } from "evlog";

import { runtime } from "../runtime";
import { removeComposeStack, removeProjectNetwork } from "../swarm";

export type OrphanResourceType = "service" | "volume" | "network" | "image" | "compose_stack";

export interface RecordOrphanInput {
  organizationId: OrganizationId;
  resourceType: OrphanResourceType;
  /** The ref the teardown primitive needs (service name, volume name, project
   *  slug for a network, image repo, compose resource id). */
  ref: string;
  projectId?: ProjectId;
  serverId?: ServerId;
  label?: string;
  payload?: Record<string, unknown>;
}

/**
 * Record a runtime object whose teardown failed so the GC sweep can retry it.
 * Best-effort and never throws — it is called from delete paths that have
 * already (or are about to) commit the DB delete; a failure to record must not
 * turn into a failure to delete.
 */
export async function recordOrphanedResource(input: RecordOrphanInput): Promise<void> {
  try {
    await db.insert(orphanedResource).values({
      organizationId: input.organizationId,
      resourceType: input.resourceType,
      ref: input.ref,
      projectId: input.projectId ?? null,
      serverId: input.serverId ?? null,
      label: input.label ?? null,
      payload: input.payload ?? null,
    });
    log.warn({
      orphanGc: { event: "recorded", type: input.resourceType, ref: input.ref },
    });
  } catch (cause) {
    log.error({
      orphanGc: { event: "record-failed", type: input.resourceType, ref: input.ref },
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

// ─── Backoff / due selection (pure, unit-tested) ─────────────────────────────

const BASE_BACKOFF_MS = 60_000; // 1m after the first failure…
const MAX_BACKOFF_MS = 60 * 60_000; // …doubling up to 1h.
/** Attempts past which we escalate the log — the object is stuck (daemon down,
 *  or a bug in the teardown primitive) and wants operator eyes. */
export const ORPHAN_ATTEMPT_ESCALATION = 8;

/**
 * Is this orphan due for another teardown attempt? Never-tried rows are always
 * due; retried rows wait an exponential backoff keyed on their attempt count so
 * a persistently-unreachable object isn't hammered every tick.
 */
export function isOrphanDue(
  row: { attempts: number; lastAttemptAt: Date | null },
  now: Date,
  baseBackoffMs = BASE_BACKOFF_MS,
): boolean {
  if (!row.lastAttemptAt) return true;
  const backoff = Math.min(baseBackoffMs * 2 ** Math.min(row.attempts, 6), MAX_BACKOFF_MS);
  return now.getTime() - row.lastAttemptAt.getTime() >= backoff;
}

// ─── Teardown dispatch ───────────────────────────────────────────────────────

type OrphanRow = typeof orphanedResource.$inferSelect;

/** Outcome of one teardown attempt. `gone` ⇒ delete the row; `retry` ⇒ bump
 *  attempts and try again later. */
type DestroyOutcome = "gone" | "retry";

function looksNotFound(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /not found|no such|404/i.test(msg);
}

/** Run a throwing teardown primitive: success (or a not-found, meaning already
 *  gone) ⇒ clear the row; any other error ⇒ retry later. */
async function attemptDestroy(fn: () => Promise<void>): Promise<DestroyOutcome> {
  try {
    await fn();
    return "gone";
  } catch (err) {
    return looksNotFound(err) ? "gone" : "retry";
  }
}

async function destroyVolumeOrphan(row: OrphanRow): Promise<DestroyOutcome> {
  const { removeVolume } = await import("../routers/volumes/service");
  const res = await removeVolume(row.ref, row.organizationId);
  if (res.ok) return "gone";
  // not-found ⇒ already gone; conflict ⇒ a live container references it, so it
  // isn't actually orphaned — stop tracking it. Only a hard error retries.
  return res.kind === "not-found" || res.kind === "conflict" ? "gone" : "retry";
}

async function destroyImageOrphan(row: OrphanRow): Promise<DestroyOutcome> {
  // Host image reclaim is itself best-effort (never throws); the payload carries
  // the ids it needs. Nothing to retry — clear the row after one go.
  const payload = (row.payload ?? {}) as { projectId?: string; resourceId?: string };
  if (payload.projectId && payload.resourceId) {
    const { reclaimServiceHostArtifacts } = await import("../routers/service/teardown");
    await reclaimServiceHostArtifacts(
      row.ref,
      payload.projectId as ProjectId,
      payload.resourceId as ResourceId,
    );
  }
  return "gone";
}

async function destroyOrphan(row: OrphanRow): Promise<DestroyOutcome> {
  switch (row.resourceType) {
    case "service":
      // runtime().destroy dispatches by mode (swarm service remove / docker
      // container force-remove); no-ops on a missing service.
      return attemptDestroy(() => runtime().destroy({ serviceName: row.ref }));
    case "compose_stack":
      return attemptDestroy(() => removeComposeStack({ resourceId: row.ref }));
    case "volume":
      return destroyVolumeOrphan(row);
    case "image":
      return destroyImageOrphan(row);
    case "network":
      // removeProjectNetwork is best-effort (logs, never throws), so we can't
      // distinguish "removed" from "daemon down". Attempt once and clear — a
      // leaked empty overlay network is low-cost and the next deploy reuses it.
      await removeProjectNetwork(row.ref);
      return "gone";
    default:
      return "gone";
  }
}

// ─── Sweep ───────────────────────────────────────────────────────────────────

export interface OrphanSweepSummary {
  considered: number;
  reclaimed: number;
  retried: number;
}

let running = false;

/** One GC pass. Self-guards against overlap; never throws. */
export async function sweepOrphanedResources(now = new Date()): Promise<OrphanSweepSummary> {
  const summary: OrphanSweepSummary = { considered: 0, reclaimed: 0, retried: 0 };
  if (running) return summary;
  running = true;
  try {
    // Oldest-attempted first so a backlog drains fairly. Nulls (never tried)
    // sort first under ASC, which is what we want.
    const rows = await db
      .select()
      .from(orphanedResource)
      .orderBy(asc(orphanedResource.lastAttemptAt))
      .limit(200);

    for (const row of rows) {
      if (!isOrphanDue(row, now)) continue;
      summary.considered++;

      let outcome: DestroyOutcome;
      try {
        outcome = await destroyOrphan(row);
      } catch (cause) {
        // destroyOrphan already contains its own throwing calls; this guards the
        // dynamic imports / unexpected errors so one bad row can't abort the pass.
        outcome = "retry";
        log.error({
          orphanGc: { event: "destroy-threw", id: row.id, type: row.resourceType },
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }

      if (outcome === "gone") {
        await db.delete(orphanedResource).where(eq(orphanedResource.id, row.id));
        summary.reclaimed++;
        log.info({
          orphanGc: { event: "reclaimed", type: row.resourceType, ref: row.ref },
        });
      } else {
        const attempts = row.attempts + 1;
        await db
          .update(orphanedResource)
          .set({ attempts, lastAttemptAt: now })
          .where(eq(orphanedResource.id, row.id));
        summary.retried++;
        if (attempts >= ORPHAN_ATTEMPT_ESCALATION) {
          log.error({
            orphanGc: { event: "stuck", type: row.resourceType, ref: row.ref, attempts },
          });
        }
      }
    }
  } catch (cause) {
    log.error({
      orphanGc: { event: "sweep-failed" },
      error: cause instanceof Error ? cause.message : String(cause),
    });
  } finally {
    running = false;
  }
  return summary;
}

/** Start the periodic GC sweep. Returns a stop handle. Mirrors the other
 *  interval sweeps in apps/server/src/background-services.ts. */
export function startOrphanResourceGc(intervalMs = 5 * 60_000): () => void {
  const timer = setInterval(() => {
    void sweepOrphanedResources();
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
