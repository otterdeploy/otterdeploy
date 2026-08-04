/**
 * Materializing ONE compose service's `service_resource` row.
 *
 * Split out of reconcile.ts, which owns the orchestration loop and the
 * teardown pass — this is the row-level mechanics that loop calls per service.
 */

import type { EnvironmentId, ResourceId } from "@otterdeploy/shared/id";

import type { StackReconcileContext } from "./reconcile";

// Via the barrel, as reconcile.ts did before the split — importing the deep
// paths instead orphans the re-exports and trips the dead-code ratchet.
import {
  bulkReplaceServiceMounts,
  createServiceRecord,
  updateServiceRecord,
} from "../service/queries";
import { pickResourceName, type toServiceFields } from "./reconcile-map";

export /**
 * Bring ONE compose service's `service_resource` row in line with the file:
 * update the existing row's structure, or create it (plus its one-time seeds)
 * the first time the service is materialized.
 *
 * Split out of {@link reconcileStackServices} because the create/update fork
 * and the two "seeded once on create, user-owned from then on" rules that hang
 * off it (env, bind mounts) are a self-contained decision — the reconcile loop
 * only needs the resulting `(resourceId, isCreate)` pair, and every branch kept
 * inline there competes for attention with the per-service crash tolerance the
 * loop itself exists to provide.
 */
async function materializeServiceRow(input: {
  ctx: StackReconcileContext;
  composeServiceName: string;
  mapped: ReturnType<typeof toServiceFields>;
  existingResourceId: ResourceId | undefined;
  /** The owning stack's environment — a child belongs wherever its stack does.
   *  Read from the stack row rather than threaded through every context
   *  construction site, so it cannot go missing on one path and it follows the
   *  stack if that ever moves. */
  environmentId: EnvironmentId | null;
}): Promise<{ resourceId: ResourceId; isCreate: boolean }> {
  const { ctx, mapped } = input;
  if (input.existingResourceId) {
    // Structure (image/command/replicas/healthcheck/resources) tracks the
    // file. Env + ports + name are left alone — the user owns env post-create.
    await updateServiceRecord(input.existingResourceId, mapped.fields);
    return { resourceId: input.existingResourceId, isCreate: false };
  }

  const name = await pickResourceName(ctx.projectId, input.composeServiceName);
  const created = await createServiceRecord({
    projectId: ctx.projectId,
    environmentId: input.environmentId,
    name,
    status: "draft",
    source: "image",
    internalHostname: mapped.internalHostname,
    serviceName: mapped.serviceName,
    networkName: mapped.networkName,
    stackId: ctx.stackResourceId,
    ports: mapped.ports,
    env: mapped.env,
    ...mapped.fields,
  });
  const resourceId = created.resource.id;
  // Seed bind mounts (multi-file inline stacks) ONCE, on create — mirroring
  // the env "user owns it post-create" convention, so a later compose edit
  // never clobbers user-managed mounts and existing stacks are untouched.
  if (mapped.mounts.length > 0) {
    await bulkReplaceServiceMounts(resourceId, mapped.mounts);
  }
  return { resourceId, isCreate: true };
}
