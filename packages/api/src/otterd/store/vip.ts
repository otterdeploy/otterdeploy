/**
 * A service's stable address. A VIP-mode service with ports gets one VIP
 * the first time a grant is admitted for it; the address is never reused,
 * even after the service is gone.
 */
import type { ServiceSpec } from "@otterdeploy/otterd-proto";

import { otterdService } from "@otterdeploy/db/schema/otterd";
import { ipam } from "@otterdeploy/otterd-cp";
import { eq } from "drizzle-orm";

import type { Tx } from "../../health-data/sql";
import type { LoadedPlan } from "./plan-row";

import { refusal } from "./errors";

const vipIdOf = (resourceId: string) => `vip.${resourceId}`;

export async function ensureVip(
  tx: Tx,
  loaded: LoadedPlan,
  resourceId: string,
  spec: ServiceSpec,
  now: number,
): Promise<{ vipId: string; address: string } | null> {
  if (spec.endpoint.mode !== "vip" || (spec.endpoint.ports ?? []).length === 0) return null;
  const [svc] = await tx
    .select({ vipId: otterdService.vipId, vipAddress: otterdService.vipAddress })
    .from(otterdService)
    .where(eq(otterdService.resourceId, resourceId))
    .for("update");
  if (svc?.vipId && svc.vipAddress) return { vipId: svc.vipId, address: svc.vipAddress };
  const vipId = vipIdOf(resourceId);
  const vip = ipam.allocateVip(loaded.plan, vipId);
  if (vip.isErr()) throw refusal(`address-${vip.error.kind}`, vip.error.message);
  const address = ipam.formatAddr(vip.value);
  await tx
    .update(otterdService)
    .set({ vipId, vipAddress: address, updatedAt: now })
    .where(eq(otterdService.resourceId, resourceId));
  return { vipId, address };
}
