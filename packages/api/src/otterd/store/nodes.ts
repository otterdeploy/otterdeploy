import type { MachineBinding, NodeAdminState, UpgradeView } from "@otterdeploy/otterd-cp";

/**
 * Node administration: cordon, drain, retire, fence policy and the rolling
 * upgrade's phases. Enabling an automatic fence is an install-admin decision
 * that can power off every workload on the host; it is journalled.
 */
import { db } from "@otterdeploy/db";
import { otterdNode } from "@otterdeploy/db/schema/otterd";
import { Result } from "better-result";
import { eq } from "drizzle-orm";

import { type StoreFailure, refusal, toStoreFailure, run } from "./errors";
import { journal } from "./journal";

export function setAdmin(
  nodeId: string,
  admin: NodeAdminState,
  now: number,
  by: string,
): Promise<Result<void, StoreFailure>> {
  return run(async (tx) => {
    const [row] = await tx
      .update(otterdNode)
      .set({ admin, updatedAt: now })
      .where(eq(otterdNode.nodeId, nodeId))
      .returning();
    if (!row) throw refusal("unknown-node", `no node ${nodeId}`);
    await journal(tx, { at: now, kind: `node-${admin}`, nodeId, detail: { by } });
  });
}

export function setFence(
  nodeId: string,
  fence: { adapter: "hetzner" | "manual"; binding: MachineBinding; enabled: boolean },
  now: number,
  by: string,
): Promise<Result<void, StoreFailure>> {
  return run(async (tx) => {
    const [row] = await tx
      .update(otterdNode)
      .set({
        fenceAdapter: fence.adapter,
        fenceBinding: fence.binding,
        fenceEnabled: fence.enabled,
        updatedAt: now,
      })
      .where(eq(otterdNode.nodeId, nodeId))
      .returning();
    if (!row) throw refusal("unknown-node", `no node ${nodeId}`);
    await journal(tx, {
      at: now,
      kind: fence.enabled ? "fence-enabled" : "fence-disabled",
      nodeId,
      detail: { by, adapter: fence.adapter, binding: fence.binding },
    });
  });
}

/** Queue nodes for a rolling otterd upgrade; the planner runs them one at a time. */
export function queueUpgrade(
  nodeIds: readonly string[],
  now: number,
  by: string,
): Promise<Result<void, StoreFailure>> {
  return run(async (tx) => {
    for (const nodeId of nodeIds) {
      await tx
        .update(otterdNode)
        .set({
          upgradePhase: "queued",
          upgradeFromIncarnation: null,
          upgradeSince: now,
          updatedAt: now,
        })
        .where(eq(otterdNode.nodeId, nodeId));
      await journal(tx, { at: now, kind: "upgrade-queued", nodeId, detail: { by } });
    }
  });
}

/**
 * Move a node to an upgrade phase. Draining cordons it and records the
 * incarnation the upgrade will replace; done makes it active again.
 */
export function setUpgradePhase(
  nodeId: string,
  phase: Exclude<UpgradeView["phase"], "queued">,
  now: number,
): Promise<Result<void, StoreFailure>> {
  return run(async (tx) => {
    const [node] = await tx
      .select()
      .from(otterdNode)
      .where(eq(otterdNode.nodeId, nodeId))
      .for("update");
    if (!node) throw refusal("unknown-node", `no node ${nodeId}`);
    const admin = phase === "draining" ? "cordoned" : phase === "done" ? "active" : node.admin;
    const from = phase === "draining" ? node.incarnation : node.upgradeFromIncarnation;
    await tx
      .update(otterdNode)
      .set({
        upgradePhase: phase,
        upgradeFromIncarnation: from,
        upgradeSince: now,
        admin,
        updatedAt: now,
      })
      .where(eq(otterdNode.nodeId, nodeId));
    await journal(tx, { at: now, kind: `upgrade-${phase}`, nodeId, detail: { from } });
  });
}

export type NodeRow = typeof otterdNode.$inferSelect;

export function nodeRow(nodeId: string): Promise<Result<NodeRow | null, StoreFailure>> {
  return Result.tryPromise({
    catch: toStoreFailure,
    try: async () => {
      const [row] = await db.select().from(otterdNode).where(eq(otterdNode.nodeId, nodeId));
      return row ?? null;
    },
  });
}
