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
  /** The newest attempt's container, when the node reported one. */
  container: string | null;
  /** Why the newest attempt could not run, when the node says so. */
  failure: { code: string; message: string } | null;
  running: boolean;
  failed: boolean;
  /** The attempt a restarted node held for this grant, awaiting adoption or a stop. */
  held: string | null;
}

type Attempt = SlotReport["attempts"][number];

const newestOf = (r: SlotReport) =>
  r.attempts.reduce<Attempt | undefined>(
    (a, b) => (a === undefined || b.ordinal > a.ordinal ? b : a),
    undefined,
  );

const startSettled = (a: Attempt | undefined) =>
  a?.mutations.some((m) => m.verb === "start" && m.state === "settled") ?? false;

function healthOf(r: SlotReport): Health {
  const newest = newestOf(r);
  // `paused` is a frozen process: live for exclusivity (it is never released
  // without a stop certificate), but not running, healthy or serving.
  const state = newest?.process.state;
  // A node that does not observe processes in its reports says `unknown`;
  // then a running grant whose newest attempt's start settled counts as running.
  const unobserved = state === "unknown" && r.state === "running" && startSettled(newest);
  // Held from an earlier node process: kept (paused) until adopted or stopped.
  const held = r.held?.attemptId ?? null;
  return {
    attempts: r.attempts.map((a) => a.attemptId),
    container: newest?.container ?? null,
    running: !held && (state === "running" || unobserved),
    // An attempt the node could not run (image pull, create or start refused)
    // is terminal: the node never retries it, so it counts as failed.
    failed: !held && (state === "exited" || newest?.failure !== undefined),
    failure: newest?.failure ?? null,
    held,
  };
}

type GrantRow = typeof otterdGrant.$inferSelect;

const isDistinctFromSession = (sessionId: string) =>
  sql`${otterdNode.reportedSession} is distinct from ${sessionId}`;
type HealthUpdate = Pick<
  GrantRow,
  "attempts" | "runningSince" | "failed" | "state" | "heldAttempt" | "container" | "failure"
>;

const sameFailure = (a: Health["failure"], b: GrantRow["failure"]) =>
  a?.code === b?.code && a?.message === b?.message;

/** Whether the computed columns equal the grant's stored ones. */
function unchanged(g: GrantRow, next: HealthUpdate): boolean {
  return (
    next.heldAttempt === g.heldAttempt &&
    next.attempts.length === g.attempts.length &&
    next.runningSince === g.runningSince &&
    next.failed === g.failed &&
    next.state === g.state &&
    next.container === g.container &&
    sameFailure(next.failure, g.failure)
  );
}

/** The grant's new health columns, or null when the report changes nothing. */
function nextHealth(g: GrantRow, h: Health, now: number): HealthUpdate | null {
  const live = g.state === "granted" || g.state === "starting" || g.state === "running";
  const next: HealthUpdate = {
    attempts: [...new Set([...g.attempts, ...h.attempts])],
    runningSince: h.running ? (g.runningSince ?? now) : null,
    failed: h.failed,
    state: live && h.running ? "running" : g.state,
    heldAttempt: h.held,
    container: h.container ?? g.container,
    failure: h.failure,
  };
  return unchanged(g, next) ? null : next;
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
