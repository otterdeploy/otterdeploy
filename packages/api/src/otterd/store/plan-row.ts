/**
 * The fleet address plan's row: read it in the caller's transaction, write
 * it back with an optimistic revision check, so two writers can never both
 * commit from the same plan.
 */
import { otterdAddressPlan } from "@otterdeploy/db/schema/otterd-network";
import { ipam } from "@otterdeploy/otterd-cp";
import { and, eq } from "drizzle-orm";

import type { Tx } from "../../health-data/sql";

import { refusal, run } from "./errors";

const PLAN_ID = 1;
export interface LoadedPlan {
  plan: ipam.AddressPlan;
  revision: number;
}

export async function readPlan(tx: Tx): Promise<LoadedPlan> {
  const [row] = await tx.select().from(otterdAddressPlan).where(eq(otterdAddressPlan.id, PLAN_ID));
  const plan = row ? ipam.planFromJson(row.plan) : ipam.newPlan(ipam.DEFAULT_LAYOUT);
  if (plan.isErr()) throw refusal("address-plan-unreadable", plan.error);
  return { plan: plan.value, revision: row?.revision ?? 0 };
}

/** Write the plan back; refused when another writer committed since it was read. */
export async function writePlan(tx: Tx, loaded: LoadedPlan, now: number): Promise<void> {
  const plan = ipam.planToJson(loaded.plan);
  const written =
    loaded.revision === 0
      ? await tx
          .insert(otterdAddressPlan)
          .values({ id: PLAN_ID, plan, revision: 1, updatedAt: now })
          .onConflictDoNothing()
          .returning()
      : await tx
          .update(otterdAddressPlan)
          .set({ plan, revision: loaded.revision + 1, updatedAt: now })
          .where(
            and(eq(otterdAddressPlan.id, PLAN_ID), eq(otterdAddressPlan.revision, loaded.revision)),
          )
          .returning();
  if (written.length === 0) {
    throw refusal("address-plan-moved", "the address plan changed under this transaction");
  }
}

/**
 * What the address plan holds back, for the admin state: each quarantined
 * address and the peers it still waits for. A peer that went away without
 * a fence keeps its entries here until it acknowledges or is fenced.
 */
export const addressState = () =>
  run(async (tx) => {
    const { plan, revision } = await readPlan(tx);
    const json = ipam.planToJson(plan);
    return { revision, nodes: json.nodes, vips: json.vips, quarantine: json.quarantine };
  });
