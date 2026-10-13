import { db } from "@otterdeploy/db";
import { otterdDecision } from "@otterdeploy/db/schema/otterd";

/** The decision journal: every scheduler and failover decision, with its reason. */
import type { Tx } from "../../health-data/sql";

export interface Decision {
  at: number;
  kind: string;
  resourceId?: string | null;
  slotIndex?: number | null;
  nodeId?: string | null;
  grantId?: string | null;
  detail: Record<string, unknown>;
}

export async function journal(q: Tx | typeof db, d: Decision): Promise<void> {
  await q.insert(otterdDecision).values({
    at: d.at,
    kind: d.kind,
    resourceId: d.resourceId ?? null,
    slotIndex: d.slotIndex ?? null,
    nodeId: d.nodeId ?? null,
    grantId: d.grantId ?? null,
    detail: d.detail,
  });
}
