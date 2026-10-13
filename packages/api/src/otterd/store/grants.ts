/**
 * Grant transitions. Each is one short transaction; none spans a call to a
 * node. Admission and release take the slot's and the grant's row locks and
 * re-check the core rules (`admit`, `mayRelease`) on what is committed, so a
 * stale plan can only be refused, never applied. Postgres also enforces one
 * live grant per exclusive slot with a partial unique index.
 */
import {
  otterdAuthority,
  otterdEvidence,
  otterdFence,
  otterdGrant,
  otterdNode,
  otterdService,
  otterdSlot,
} from "@otterdeploy/db/schema/otterd";
import { admit, mayRelease } from "@otterdeploy/otterd-cp";
import { Result } from "better-result";
import { and, eq, ne, sql } from "drizzle-orm";

import type { Tx } from "../../health-data/sql";

import { type StoreFailure, mintId, refusal, run } from "./errors";
import { journal } from "./journal";
import { allocateNetwork, releaseNetwork } from "./network";
import { type GrantRow, grantView, retirementOf } from "./rows";

export interface IssueRequest {
  resourceId: string;
  slotIndex: number;
  nodeId: string;
  exclusive: boolean;
  surge: boolean;
  specRevision: number;
  reason: string;
  now: number;
  /** A migration's grant: adopt this legacy container in place. */
  adoptsContainer?: string;
}

export async function lockedGrant(tx: Tx, grantId: string): Promise<GrantRow> {
  const [g] = await tx
    .select()
    .from(otterdGrant)
    .where(eq(otterdGrant.grantId, grantId))
    .for("update");
  if (!g) throw refusal("unknown-grant", `no grant ${grantId}`);
  return g;
}

/**
 * Admit a new generation of a slot on a connected node, as Prepared: nothing
 * has left the control plane yet. Takes the slot lock, re-checks admission
 * on the committed grants and raises the generation high-water and the
 * resource's operation epoch.
 */
export function admitGrant(req: IssueRequest): Promise<Result<GrantRow, StoreFailure>> {
  return run(async (tx) => {
    const [node] = await tx
      .select()
      .from(otterdNode)
      .where(eq(otterdNode.nodeId, req.nodeId))
      .for("share");
    if (!node?.sessionId || !node.incarnation) {
      throw refusal("node-not-connected", `${req.nodeId} has no control session`);
    }
    const [authority] = await tx.select().from(otterdAuthority).limit(1).for("share");
    if (!authority) throw refusal("no-authority", "the control plane has no issuing authority");
    await tx
      .insert(otterdSlot)
      .values({ resourceId: req.resourceId, slotIndex: req.slotIndex })
      .onConflictDoNothing();
    const slotKey = and(
      eq(otterdSlot.resourceId, req.resourceId),
      eq(otterdSlot.slotIndex, req.slotIndex),
    );
    const [slot] = await tx.select().from(otterdSlot).where(slotKey).for("update");
    const live = await tx
      .select()
      .from(otterdGrant)
      .where(
        and(
          eq(otterdGrant.resourceId, req.resourceId),
          eq(otterdGrant.slotIndex, req.slotIndex),
          ne(otterdGrant.state, "released"),
        ),
      );
    const generation = admit(
      { highWater: slot?.generationHighWater ?? 0, grants: live.map(grantView) },
      { exclusive: req.exclusive, surge: req.surge },
    );
    if (generation.isErr()) throw refusal(generation.error.code, JSON.stringify(generation.error));
    const [svc] = await tx
      .update(otterdService)
      .set({ operationEpoch: sql`${otterdService.operationEpoch} + 1`, updatedAt: req.now })
      .where(eq(otterdService.resourceId, req.resourceId))
      .returning();
    if (!svc) throw refusal("unknown-service", `no service ${req.resourceId}`);
    await tx.update(otterdSlot).set({ generationHighWater: generation.value }).where(slotKey);
    // A container adopted in place keeps the network it was created with: its
    // grant carries none (a node refuses one that does).
    const network = req.adoptsContainer ? null : await allocateNetwork(tx, req);
    const [grant] = await tx
      .insert(otterdGrant)
      .values({
        grantId: mintId("grant"),
        resourceId: req.resourceId,
        slotIndex: req.slotIndex,
        generation: generation.value,
        authorityTerm: authority.authorityTerm,
        nodeId: node.nodeId,
        nodeEpoch: node.nodeEpoch,
        incarnation: node.incarnation,
        exclusive: req.exclusive,
        specRevision: req.specRevision,
        state: "prepared",
        surge: req.surge,
        operationEpoch: svc.operationEpoch,
        opId: mintId("op"),
        network,
        adoptsContainer: req.adoptsContainer ?? null,
        createdAt: req.now,
      })
      .returning();
    if (!grant) throw refusal("insert-failed", "grant not inserted");
    await journal(tx, {
      at: req.now,
      kind: "issue",
      resourceId: req.resourceId,
      slotIndex: req.slotIndex,
      nodeId: req.nodeId,
      grantId: grant.grantId,
      detail: {
        generation: generation.value,
        surge: req.surge,
        revision: req.specRevision,
        reason: req.reason,
        ...(network ? { address: network.address, subnet: network.subnet } : {}),
      },
    });
    return grant;
  });
}

/** Prepared → Granted, durably, before the grant is sent. From here only evidence releases it. */
export function markSent(grantId: string, now: number): Promise<Result<GrantRow, StoreFailure>> {
  return run(async (tx) => {
    const g = await lockedGrant(tx, grantId);
    if (g.state !== "prepared") return g;
    const [out] = await tx
      .update(otterdGrant)
      .set({ state: "granted", sentAt: now })
      .where(eq(otterdGrant.grantId, grantId))
      .returning();
    return out ?? g;
  });
}

type Mark = "revoke" | "stop" | "orphan" | "applied";

/** Revocation intent, a stop request, orphan-possible, or the node's acceptance. */
export function markGrant(
  grantId: string,
  mark: Mark,
  now: number,
  reason: string,
): Promise<Result<GrantRow, StoreFailure>> {
  return run(async (tx) => {
    const g = await lockedGrant(tx, grantId);
    if (g.state === "released") return g;
    const revokedAt = g.revokedAt ?? now;
    const set =
      mark === "revoke"
        ? { revokedAt, state: g.state === "stopping" ? "stopping" : "unknown" }
        : mark === "stop"
          ? { revokedAt, stopRequestedAt: g.stopRequestedAt ?? now, state: "stopping" }
          : mark === "orphan"
            ? { orphan: true }
            : { state: g.state === "granted" ? "starting" : g.state };
    const [out] = await tx
      .update(otterdGrant)
      .set(set)
      .where(eq(otterdGrant.grantId, grantId))
      .returning();
    if (mark !== "applied") {
      await journal(tx, {
        at: now,
        kind: mark,
        resourceId: g.resourceId,
        slotIndex: g.slotIndex,
        nodeId: g.nodeId,
        grantId,
        detail: { reason },
      });
    }
    return out ?? g;
  });
}

/**
 * Release a grant: only a Prepared grant that never left the control plane,
 * or one with positive retirement evidence bound to it, re-checked here on
 * the committed evidence in the same transaction.
 */
export function releaseGrant(
  grantId: string,
  now: number,
): Promise<Result<GrantRow, StoreFailure>> {
  return run(async (tx) => {
    const g = await lockedGrant(tx, grantId);
    const evidence = await tx
      .select()
      .from(otterdEvidence)
      .where(and(eq(otterdEvidence.nodeId, g.nodeId), eq(otterdEvidence.nodeEpoch, g.nodeEpoch)));
    const fences = await tx
      .select()
      .from(otterdFence)
      .where(and(eq(otterdFence.nodeId, g.nodeId), eq(otterdFence.nodeEpoch, g.nodeEpoch)));
    const retirement = retirementOf(g, evidence, fences);
    const ok = mayRelease(grantView(g), retirement);
    if (ok.isErr()) throw refusal(ok.error.code, `grant ${grantId}: ${JSON.stringify(ok.error)}`);
    const [out] = await tx
      .update(otterdGrant)
      .set({
        state: "released",
        releasedAt: now,
        releaseEvidenceId: retirement?.evidenceId ?? null,
      })
      .where(eq(otterdGrant.grantId, grantId))
      .returning();
    await releaseNetwork(tx, out ?? g, now);
    // A start-first candidate whose incumbent is gone becomes the slot's incumbent.
    const rest = await tx
      .select()
      .from(otterdGrant)
      .where(
        and(
          eq(otterdGrant.resourceId, g.resourceId),
          eq(otterdGrant.slotIndex, g.slotIndex),
          ne(otterdGrant.state, "released"),
          eq(otterdGrant.orphan, false),
        ),
      );
    if (rest.length > 0 && rest.every((x) => x.surge)) {
      await tx
        .update(otterdGrant)
        .set({ surge: false })
        .where(
          and(
            eq(otterdGrant.resourceId, g.resourceId),
            eq(otterdGrant.slotIndex, g.slotIndex),
            ne(otterdGrant.state, "released"),
          ),
        );
    }
    await journal(tx, {
      at: now,
      kind: "release",
      resourceId: g.resourceId,
      slotIndex: g.slotIndex,
      nodeId: g.nodeId,
      grantId,
      detail: { by: ok.value, evidence: retirement },
    });
    return out ?? g;
  });
}
