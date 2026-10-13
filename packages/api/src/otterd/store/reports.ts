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
import { and, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";

import { type StoreFailure, toStoreFailure, run } from "./errors";
import { journal } from "./journal";

interface Health {
  attempts: string[];
  running: boolean;
  failed: boolean;
  /** The attempt a restarted node held for this grant, awaiting adoption or a stop. */
  held: string | null;
}

function healthOf(r: SlotReport): Health {
  const newest = r.attempts.reduce<SlotReport["attempts"][number] | undefined>(
    (a, b) => (a === undefined || b.ordinal > a.ordinal ? b : a),
    undefined,
  );
  const state = newest?.process.state;
  // A node that does not observe processes in its reports says `unknown`;
  // then a running grant whose newest attempt's start settled counts as running.
  const started =
    newest?.mutations.some((m) => m.verb === "start" && m.state === "settled") ?? false;
  const unobserved = state === "unknown" && r.state === "running" && started;
  // Held from an earlier node process: kept (paused) until adopted or stopped.
  const held = r.held?.attemptId ?? null;
  return {
    attempts: r.attempts.map((a) => a.attemptId),
    running: !held && (state === "running" || unobserved),
    failed: !held && state === "exited",
    held,
  };
}

type GrantRow = typeof otterdGrant.$inferSelect;

const isDistinctFromSession = (sessionId: string) =>
  sql`${otterdNode.reportedSession} is distinct from ${sessionId}`;
type HealthUpdate = Pick<
  GrantRow,
  "attempts" | "runningSince" | "failed" | "state" | "heldAttempt"
>;

/** The grant's new health columns, or null when the report changes nothing. */
function nextHealth(g: GrantRow, h: Health, now: number): HealthUpdate | null {
  const attempts = [...new Set([...g.attempts, ...h.attempts])];
  const runningSince = h.running ? (g.runningSince ?? now) : null;
  const live = g.state === "granted" || g.state === "starting" || g.state === "running";
  const state = live && h.running ? "running" : g.state;
  const same =
    h.held === g.heldAttempt &&
    attempts.length === g.attempts.length &&
    runningSince === g.runningSince &&
    h.failed === g.failed &&
    state === g.state;
  return same ? null : { attempts, runningSince, failed: h.failed, state, heldAttempt: h.held };
}

/** Apply one node's slot reports. Reports for grants of other nodes are ignored. */
export function applySlotReports(
  nodeId: string,
  sessionId: string,
  reports: readonly SlotReport[],
  now: number,
): Promise<Result<number, StoreFailure>> {
  return run(async (tx) => {
    // The session's first report: the planner may now judge the node's earlier grants.
    const [first] = await tx
      .update(otterdNode)
      .set({ reportedSession: sessionId })
      .where(
        and(
          eq(otterdNode.nodeId, nodeId),
          eq(otterdNode.sessionId, sessionId),
          isDistinctFromSession(sessionId),
        ),
      )
      .returning({ nodeId: otterdNode.nodeId });
    const ids = reports.map((r) => r.grantId);
    if (ids.length === 0) return first ? 1 : 0;
    const grants = await tx
      .select()
      .from(otterdGrant)
      .where(and(eq(otterdGrant.nodeId, nodeId), inArray(otterdGrant.grantId, ids)))
      .for("update");
    let changed = first ? 1 : 0;
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
      .set({ ...s, reportedSession: null, lastEvidenceAt: now, updatedAt: now })
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

/**
 * Grants a lease may renew: this node's, of the requesting incarnation, not
 * released and with no committed revocation. A revoked grant is never renewed.
 */
export function leaseable(
  nodeId: string,
  incarnation: string,
  grantIds: readonly string[],
): Promise<Result<string[], StoreFailure>> {
  return Result.tryPromise({
    catch: toStoreFailure,
    try: async () => {
      if (grantIds.length === 0) return [];
      const rows = await db
        .select({ grantId: otterdGrant.grantId })
        .from(otterdGrant)
        .where(
          and(
            eq(otterdGrant.nodeId, nodeId),
            eq(otterdGrant.incarnation, incarnation),
            inArray(otterdGrant.grantId, [...grantIds]),
            isNull(otterdGrant.revokedAt),
            ne(otterdGrant.state, "released"),
          ),
        );
      return rows.map((r) => r.grantId);
    },
  });
}
