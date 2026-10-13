/**
 * Serving sets: for each service with a stable address, the exact attempts
 * new flows may go to, the attempts being drained, and which nodes were told.
 *
 * A node is recorded as told before the set is pushed to it, so the peers an
 * address release waits for can only be over-counted, never missed.
 */
import { db } from "@otterdeploy/db";
import { otterdGrant, otterdService, otterdServiceRevision } from "@otterdeploy/db/schema/otterd";
import {
  type ServingAttempt,
  type ServingWithdrawal,
  otterdScope,
  otterdServing,
} from "@otterdeploy/db/schema/otterd-network";
import { MAX_DRAIN_MS, serviceSpec } from "@otterdeploy/otterd-proto";
import { Result } from "better-result";
import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { type StoreFailure, run, toStoreFailure } from "./errors";
import { journal } from "./journal";

/** A withdrawal is repeated in later sets for this long, so a node that missed one still drains. */
const WITHDRAWAL_KEEP_MS = 2 * MAX_DRAIN_MS;
const DEFAULT_DRAIN_MS = 10_000;

export interface ServingTarget {
  resourceId: string;
  scopeId: string;
  vipId: string;
  vipAddress: string;
  names: string[];
  ports: { protocol: "tcp" | "udp"; port: number }[];
  drainBudgetMs: number;
  operationEpoch: number;
  attempts: ServingAttempt[];
}

/**
 * Every VIP service's current backends: the newest attempt of each unrevoked
 * grant whose process runs now. A paused process holds its slot but takes no
 * new flows.
 */
export function servingTargets(): Promise<Result<ServingTarget[], StoreFailure>> {
  return Result.tryPromise({
    try: async () => {
      const services = await db
        .select()
        .from(otterdService)
        .innerJoin(
          otterdServiceRevision,
          and(
            eq(otterdServiceRevision.resourceId, otterdService.resourceId),
            eq(otterdServiceRevision.revision, otterdService.revision),
          ),
        )
        .where(isNotNull(otterdService.vipAddress));
      const grants = await db
        .select()
        .from(otterdGrant)
        .where(
          and(
            eq(otterdGrant.state, "running"),
            isNotNull(otterdGrant.runningSince),
            isNull(otterdGrant.revokedAt),
          ),
        );
      const scopes = new Map((await db.select().from(otterdScope)).map((s) => [s.scopeId, s]));
      return services.flatMap(({ otterd_service: svc, otterd_service_revision: rev }) => {
        const spec = serviceSpec.safeParse(rev.spec);
        const scope = spec.success ? scopes.get(spec.data.endpoint.scopes?.[0] ?? "") : undefined;
        if (!spec.success || !scope || !svc.vipId || !svc.vipAddress) return [];
        const attempts = grants.flatMap((g) => {
          const attemptId = g.attempts.at(-1);
          return g.resourceId === svc.resourceId && g.network && attemptId
            ? [
                {
                  grantId: g.grantId,
                  attemptId,
                  nodeId: g.nodeId,
                  nodeEpoch: g.nodeEpoch,
                  address: g.network.address,
                },
              ]
            : [];
        });
        return [
          {
            resourceId: svc.resourceId,
            scopeId: scope.scopeId,
            vipId: svc.vipId,
            vipAddress: svc.vipAddress,
            names: (spec.data.endpoint.aliases ?? []).map((a) => `${a}.${scope.zone}`),
            ports: (spec.data.endpoint.ports ?? []).map((p) => ({
              protocol: p.protocol,
              port: p.targetPort,
            })),
            drainBudgetMs: Math.min(
              spec.data.task.container.stopGraceMs ?? DEFAULT_DRAIN_MS,
              MAX_DRAIN_MS,
            ),
            operationEpoch: svc.operationEpoch,
            attempts: attempts.sort((a, b) => (a.attemptId < b.attemptId ? -1 : 1)),
          },
        ];
      });
    },
    catch: toStoreFailure,
  });
}

export type ServingRow = typeof otterdServing.$inferSelect;

/** Field by field: jsonb returns object keys in its own order. */
const attemptKey = (a: ServingAttempt) =>
  [a.grantId, a.attemptId, a.nodeId, a.nodeEpoch, a.address].join("|");

const sameAttempts = (a: ServingAttempt[], b: ServingAttempt[]) =>
  a.length === b.length &&
  a.every((x, i) => b[i] !== undefined && attemptKey(x) === attemptKey(b[i]));

/** The stored set, raised to a new revision when its backends changed. */
export function recordServing(
  t: ServingTarget,
  now: number,
): Promise<Result<ServingRow, StoreFailure>> {
  return run(async (tx) => {
    const [prev] = await tx
      .select()
      .from(otterdServing)
      .where(eq(otterdServing.resourceId, t.resourceId))
      .for("update");
    if (prev && sameAttempts(prev.attempts, t.attempts)) return prev;
    const revision = (prev?.revision ?? 0) + 1;
    const kept = new Set(t.attempts.map((a) => a.attemptId));
    const withdrawn: ServingWithdrawal[] = (prev?.attempts ?? [])
      .filter((a) => !kept.has(a.attemptId))
      .map((a) => ({
        attemptId: a.attemptId,
        withdrawalRevision: revision,
        drainBudgetMs: t.drainBudgetMs,
        withdrawnAt: now,
      }));
    const withdrawals = [
      ...(prev?.withdrawals ?? []).filter(
        (w) => now - w.withdrawnAt < WITHDRAWAL_KEEP_MS && !kept.has(w.attemptId),
      ),
      ...withdrawn,
    ];
    const values = {
      resourceId: t.resourceId,
      revision,
      attempts: t.attempts,
      withdrawals,
      listed: prev?.listed ?? {},
      sentTo: prev?.sentTo ?? {},
      updatedAt: now,
    };
    const [row] = await tx
      .insert(otterdServing)
      .values(values)
      .onConflictDoUpdate({ target: otterdServing.resourceId, set: values })
      .returning();
    await journal(tx, {
      at: now,
      kind: "serving-revision",
      resourceId: t.resourceId,
      detail: {
        revision,
        attempts: t.attempts.map((a) => a.attemptId),
        withdrawn: withdrawn.map((w) => w.attemptId),
      },
    });
    return row ?? { ...values };
  });
}

/** Payload digests a node may acknowledge: its most recent sets. */
const DIGESTS_KEPT = 16;

/** Record that the node is being sent this revision on this session, before it is sent. */
export function markServingSent(
  resourceId: string,
  nodeId: string,
  sessionId: string,
  sent: { revision: number; digest: string },
): Promise<Result<boolean, StoreFailure>> {
  const { revision } = sent;
  return run(async (tx) => {
    const [row] = await tx
      .select()
      .from(otterdServing)
      .where(eq(otterdServing.resourceId, resourceId))
      .for("update");
    if (!row || row.revision !== revision) return false;
    const listed = { ...row.listed };
    for (const a of row.attempts) {
      listed[a.attemptId] = [...new Set([...(listed[a.attemptId] ?? []), nodeId])].sort();
    }
    await tx
      .update(otterdServing)
      .set({
        listed,
        sentTo: {
          ...row.sentTo,
          [nodeId]: {
            ...row.sentTo[nodeId],
            revision,
            sessionId,
            digests: [
              ...(row.sentTo[nodeId]?.digests ?? []).filter((d) => d.revision !== revision),
              sent,
            ].slice(-DIGESTS_KEPT),
          },
        },
      })
      .where(eq(otterdServing.resourceId, resourceId));
    return true;
  });
}
