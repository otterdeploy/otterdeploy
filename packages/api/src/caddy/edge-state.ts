/**
 * Edge reload state on the route row.
 *
 * A route write that changes the edge used to wait for the Caddy reload
 * before answering, and a reload can take tens of seconds (over 20 s for a
 * domain add, the row itself written in milliseconds).
 * Writers now mark the row `pending` and queue the reload (./edge-sync.ts);
 * every reconcile settles the rows it loaded, so the UI reads the outcome
 * off the route (pushed on the project event stream) instead of off the
 * request.
 *
 * Settling is keyed on `edgeRevision`. The snapshot is taken BEFORE the
 * reconcile reads the routes, so every row in it was written before the
 * config was rendered. A write that lands later bumps the revision, the
 * settle skips it, and the reload queued behind that write settles it.
 */
import type { ProjectId, ProxyRouteId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { Result } from "better-result";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import type { ProxyRouteRecord } from "./queries";
import type { ReconcileResult } from "./reconciler";

import { publishRouteUpserted } from "../routers/project/project-event-bus";

/** The routes a write changed: by id, or every base route of a resource. */
export type EdgeReloadTarget = { routeIds: ProxyRouteId[] } | { resourceId: ResourceId };

export interface UnsettledRoute {
  id: ProxyRouteId;
  projectId: ProjectId;
  edgeRevision: number;
}

/** The two verdicts a reconcile can reach on a row it carried. */
export type EdgeVerdict = { state: "synced" } | { state: "failed"; error: string };

/**
 * Mark routes as waiting on the edge. Call AFTER the write that changed them
 * (see the module comment), with the ids, or with a resource to cover all of
 * its base routes (expose/unexpose flip them in bulk).
 */
export async function markRoutesEdgePending(target: EdgeReloadTarget): Promise<ProxyRouteRecord[]> {
  if ("routeIds" in target && target.routeIds.length === 0) return [];
  const rows = await db
    .update(proxyRoute)
    .set({
      edgeState: "pending",
      edgeError: null,
      edgeRevision: sql`${proxyRoute.edgeRevision} + 1`,
    })
    .where(
      "routeIds" in target
        ? inArray(proxyRoute.id, target.routeIds)
        : and(eq(proxyRoute.resourceId, target.resourceId), isNull(proxyRoute.previewId)),
    )
    .returning();
  for (const row of rows) publishRouteUpserted("updated", row);
  return rows;
}

/** Rows whose last change the edge has not confirmed: pending, or failed and
 *  waiting on a retry that may now succeed. */
export async function listUnsettledRoutes(): Promise<UnsettledRoute[]> {
  return db
    .select({
      id: proxyRoute.id,
      projectId: proxyRoute.projectId,
      edgeRevision: proxyRoute.edgeRevision,
    })
    .from(proxyRoute)
    .where(ne(proxyRoute.edgeState, "synced"));
}

/**
 * What a reconcile means for one row it carried. A load Caddy refused fails
 * every row; a project the reconciler skipped (its fragment did not adapt)
 * fails that project's rows with the adapt error; everything else loaded.
 */
export function edgeVerdict(projectId: string, result: ReconcileResult): EdgeVerdict {
  if (result.loadError) return { state: "failed", error: result.loadError };
  const skipped = result.skipped.find((s) => s.projectId === projectId);
  if (skipped) return { state: "failed", error: skipped.error };
  return { state: "synced" };
}

/**
 * Record a reconcile's outcome on the rows it carried.
 *
 * `failure` is the reconcile's own error when it threw rather than
 * returning. `recordFailures: false` settles only loads that landed: a
 * process that cannot reach the edge (the build worker) gets a load error
 * that says nothing about the route, and the control plane's own reload is
 * the one whose failure counts.
 */
export async function settleRoutes(
  carried: UnsettledRoute[],
  outcome: { result: ReconcileResult } | { failure: string },
  options: { recordFailures: boolean },
): Promise<void> {
  for (const route of carried) {
    const verdict: EdgeVerdict =
      "failure" in outcome
        ? { state: "failed", error: outcome.failure }
        : edgeVerdict(route.projectId, outcome.result);
    if (verdict.state === "failed" && !options.recordFailures) continue;
    const row =
      verdict.state === "synced"
        ? await settleRoute(route, { edgeState: "synced", edgeError: null })
        : await settleRoute(route, { edgeState: "failed", edgeError: verdict.error });
    if (row) publishRouteUpserted("updated", row);
  }
}

/** One settle write, guarded on the revision the reconcile carried. Literal
 *  states at the call sites, so both exits read plainly. */
async function settleRoute(
  route: UnsettledRoute,
  patch: { edgeState: "synced"; edgeError: null } | { edgeState: "failed"; edgeError: string },
): Promise<ProxyRouteRecord | undefined> {
  const [row] = await db
    .update(proxyRoute)
    .set(patch)
    .where(
      and(
        eq(proxyRoute.id, route.id),
        eq(proxyRoute.edgeRevision, route.edgeRevision),
        // A row another reconcile already settled at this revision keeps that
        // verdict: two reloads that carried the same write agree on it.
        inArray(proxyRoute.edgeState, ["pending", "failed"]),
      ),
    )
    .returning();
  return row;
}

export interface ReconcileOptions {
  /** Record a failed reload on the routes it carried (`edgeState: failed`).
   *  Only the control plane's own reload queue sets this (./edge-sync.ts):
   *  other callers (the build worker cannot reach the edge at all) settle
   *  only the loads that landed. */
  recordFailures?: boolean;
}

/**
 * Run one reconcile and settle the routes it carried. The waiting rows are
 * read FIRST, so each one settled was written before the routes the reconcile
 * renders. A reconcile that throws still settles (as failed, when recording
 * failures) and then rethrows to its caller.
 */
export async function settleAround(
  run: () => Promise<ReconcileResult>,
  options: ReconcileOptions,
): Promise<ReconcileResult> {
  const carried = await listUnsettledRoutes();
  const outcome = await Result.tryPromise({
    try: run,
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
  await settleRoutes(
    carried,
    outcome.isOk() ? { result: outcome.value } : { failure: outcome.error.message },
    { recordFailures: options.recordFailures ?? false },
  );
  if (outcome.isErr()) throw outcome.error;
  return outcome.value;
}
