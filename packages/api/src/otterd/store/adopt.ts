/**
 * Grant reads and adoption: the hand-over of a held attempt to a fresh grant
 * on the same node, in one transaction.
 */
import { db } from "@otterdeploy/db";
import { otterdGrant, otterdNode, otterdService, otterdSlot } from "@otterdeploy/db/schema/otterd";
import { Result } from "better-result";
import { and, eq, sql } from "drizzle-orm";

import type { GrantRow } from "./rows";

import { type StoreFailure, mintId, refusal, toStoreFailure, run } from "./errors";
import { lockedGrant } from "./grants";
import { journal } from "./journal";

/**
 * Adopt the attempt a restarted node held: in one transaction the old grant
 * hands over (released, naming its successor) and a new generation on the
 * same node and incarnation of the live session takes the same attempt. Only
 * the slot's newest grant, never revoked or stop-requested, can hand over.
 */
export function adoptGrant(
  grantId: string,
  attemptId: string,
  now: number,
): Promise<Result<GrantRow, StoreFailure>> {
  return run(async (tx) => {
    const old = await lockedGrant(tx, grantId);
    const slotKey = and(
      eq(otterdSlot.resourceId, old.resourceId),
      eq(otterdSlot.slotIndex, old.slotIndex),
    );
    const [slot] = await tx.select().from(otterdSlot).where(slotKey).for("update");
    const [node] = await tx
      .select()
      .from(otterdNode)
      .where(eq(otterdNode.nodeId, old.nodeId))
      .for("share");
    if (old.state === "released" || old.revokedAt !== null || old.stopRequestedAt !== null) {
      throw refusal("not-adoptable", `grant ${grantId} is ${old.state}, revoked or stopping`);
    }
    if (old.heldAttempt !== attemptId)
      throw refusal("not-held", `${attemptId} is not held for ${grantId}`);
    if (!node?.sessionId || !node.incarnation || node.incarnation === old.incarnation) {
      throw refusal("node-not-restarted", `${old.nodeId} has no newer incarnation in session`);
    }
    if (!slot || slot.generationHighWater !== old.generation) {
      throw refusal(
        "slot-moved",
        `slot ${old.resourceId}#${old.slotIndex} moved past generation ${old.generation}`,
      );
    }
    const generation = slot.generationHighWater + 1;
    const [svc] = await tx
      .update(otterdService)
      .set({ operationEpoch: sql`${otterdService.operationEpoch} + 1`, updatedAt: now })
      .where(eq(otterdService.resourceId, old.resourceId))
      .returning();
    const grantIdNew = mintId("grant");
    await tx
      .update(otterdGrant)
      .set({ state: "released", releasedAt: now, releaseEvidenceId: `adopted-by:${grantIdNew}` })
      .where(eq(otterdGrant.grantId, grantId));
    await tx.update(otterdSlot).set({ generationHighWater: generation }).where(slotKey);
    const [grant] = await tx
      .insert(otterdGrant)
      .values({
        ...old,
        grantId: grantIdNew,
        generation,
        incarnation: node.incarnation,
        state: "prepared",
        operationEpoch: svc?.operationEpoch ?? old.operationEpoch + 1,
        opId: mintId("op"),
        revokedAt: null,
        stopRequestedAt: null,
        sentAt: null,
        releasedAt: null,
        releaseEvidenceId: null,
        heldAttempt: null,
        adoptsAttempt: attemptId,
        createdAt: now,
      })
      .returning();
    if (!grant) throw refusal("insert-failed", "grant not inserted");
    await journal(tx, {
      at: now,
      kind: "adopt",
      resourceId: old.resourceId,
      slotIndex: old.slotIndex,
      nodeId: old.nodeId,
      grantId: grant.grantId,
      detail: { from: grantId, attemptId, generation },
    });
    return grant;
  });
}

export function grantRow(grantId: string): Promise<Result<GrantRow | null, StoreFailure>> {
  return Result.tryPromise({
    catch: toStoreFailure,
    try: async () => {
      const [row] = await db.select().from(otterdGrant).where(eq(otterdGrant.grantId, grantId));
      return row ?? null;
    },
  });
}
