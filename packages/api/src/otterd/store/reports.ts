import type { SlotReport } from "@otterdeploy/otterd-proto";

/**
 * What nodes report: slot reports (attempts and process observations per
 * grant) and session liveness. Reports update the control plane's view of a
 * grant's attempts and health; they never release a grant or grant
 * authority. Every attempt id ever reported is kept, so a stop certificate
 * must cover all of them.
 */
import { db } from "@otterdeploy/db";
import { otterdGrant, otterdNode } from "@otterdeploy/db/schema/otterd";
import { Result } from "better-result";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

import type { Tx } from "../../health-data/sql";

import { type StoreFailure, toStoreFailure } from "./errors";
import { journal } from "./journal";

const run = <T>(f: (tx: Tx) => Promise<T>): Promise<Result<T, StoreFailure>> =>
  Result.tryPromise({ try: () => db.transaction(f), catch: toStoreFailure });

interface Health {
  attempts: string[];
  running: boolean;
  failed: boolean;
}

function healthOf(r: SlotReport): Health {
  const newest = r.attempts.reduce<SlotReport["attempts"][number] | undefined>(
    (a, b) => (a === undefined || b.ordinal > a.ordinal ? b : a),
    undefined,
  );
  const state = newest?.process.state;
  return {
    attempts: r.attempts.map((a) => a.attemptId),
    running: state === "running",
    failed: state === "exited" || state === "unknown",
  };
}

type GrantRow = typeof otterdGrant.$inferSelect;
type HealthUpdate = Pick<GrantRow, "attempts" | "runningSince" | "failed" | "state">;

/** The grant's new health columns, or null when the report changes nothing. */
function nextHealth(g: GrantRow, h: Health, now: number): HealthUpdate | null {
  const attempts = [...new Set([...g.attempts, ...h.attempts])];
  const runningSince = h.running ? (g.runningSince ?? now) : null;
  const live = g.state === "granted" || g.state === "starting" || g.state === "running";
  const state = live && h.running ? "running" : g.state;
  const same =
    attempts.length === g.attempts.length &&
    runningSince === g.runningSince &&
    h.failed === g.failed &&
    state === g.state;
  return same ? null : { attempts, runningSince, failed: h.failed, state };
}

/** Apply one node's slot reports. Reports for grants of other nodes are ignored. */
export function applySlotReports(
  nodeId: string,
  reports: readonly SlotReport[],
  now: number,
): Promise<Result<number, StoreFailure>> {
  return run(async (tx) => {
    const ids = reports.map((r) => r.grantId);
    if (ids.length === 0) return 0;
    const grants = await tx
      .select()
      .from(otterdGrant)
      .where(and(eq(otterdGrant.nodeId, nodeId), inArray(otterdGrant.grantId, ids)))
      .for("update");
    let changed = 0;
    for (const g of grants) {
      const r = reports.find((x) => x.grantId === g.grantId);
      const next = r ? nextHealth(g, healthOf(r), now) : null;
      if (!next) continue;
      changed++;
      await tx.update(otterdGrant).set(next).where(eq(otterdGrant.grantId, g.grantId));
      if (next.failed !== g.failed) {
        await journal(tx, {
          at: now,
          kind: next.failed ? "attempt-failed" : "attempt-recovered",
          resourceId: g.resourceId,
          slotIndex: g.slotIndex,
          nodeId,
          grantId: g.grantId,
          detail: { attempts: next.attempts },
        });
      }
    }
    return changed;
  });
}

/** A control session was established: record it, and the node's first evidence. */
export function sessionUp(
  nodeId: string,
  s: { sessionId: string; incarnation: string; bootId: string },
  now: number,
): Promise<Result<void, StoreFailure>> {
  return run(async (tx) => {
    const [before] = await tx
      .select()
      .from(otterdNode)
      .where(eq(otterdNode.nodeId, nodeId))
      .for("update");
    await tx
      .update(otterdNode)
      .set({ ...s, lastEvidenceAt: now, updatedAt: now })
      .where(eq(otterdNode.nodeId, nodeId));
    const restarted = before?.incarnation !== null && before?.incarnation !== s.incarnation;
    await journal(tx, {
      at: now,
      kind: "session-up",
      nodeId,
      detail: { ...s, restarted, previousIncarnation: before?.incarnation ?? null },
    });
  });
}

/** The session ended. Evidence stops; the node becomes suspect, then down, by age alone. */
export function sessionDown(
  nodeId: string,
  sessionId: string,
  now: number,
  why: string,
): Promise<Result<void, StoreFailure>> {
  return run(async (tx) => {
    const [row] = await tx
      .update(otterdNode)
      .set({ sessionId: null, updatedAt: now })
      .where(and(eq(otterdNode.nodeId, nodeId), eq(otterdNode.sessionId, sessionId)))
      .returning();
    if (row)
      await journal(tx, { at: now, kind: "session-down", nodeId, detail: { sessionId, why } });
  });
}

/** Fresh evidence from a live session (throttled by the caller). */
export function touchEvidence(
  nodeId: string,
  sessionId: string,
  now: number,
): Promise<Result<void, StoreFailure>> {
  return Result.tryPromise({
    catch: toStoreFailure,
    try: async () => {
      await db
        .update(otterdNode)
        .set({ lastEvidenceAt: sql`greatest(coalesce(${otterdNode.lastEvidenceAt}, 0), ${now})` })
        .where(and(eq(otterdNode.nodeId, nodeId), eq(otterdNode.sessionId, sessionId)));
    },
  });
}

/** At hub start: sessions recorded by an earlier hub process are not live. */
export function clearStaleSessions(now: number): Promise<Result<void, StoreFailure>> {
  return Result.tryPromise({
    catch: toStoreFailure,
    try: async () => {
      await db
        .update(otterdNode)
        .set({ sessionId: null, updatedAt: now })
        .where(isNotNull(otterdNode.sessionId));
    },
  });
}
