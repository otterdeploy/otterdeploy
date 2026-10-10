/**
 * Materializing ONE compose service's `service_resource` row.
 *
 * Split out of reconcile.ts, which owns the orchestration loop and the
 * teardown pass. This is the row-level mechanics that loop calls per service.
 */

import type { EnvironmentId, ResourceId } from "@otterdeploy/shared/id";

import type { StackReconcileContext } from "./reconcile";

// Via the barrel, as reconcile.ts did before the split, importing the deep
// paths instead orphans the re-exports and trips the dead-code ratchet.
import { allowedHostBind } from "../../lib/host-binds";
import {
  bulkReplaceServiceMounts,
  createServiceRecord,
  updateServiceRecord,
  upsertServiceMount,
} from "../service/queries";
import { pickInternalHostname, pickResourceName, type toServiceFields } from "./reconcile-map";

/**
 * Re-apply the binds the platform owns on UPDATE, not just on create:
 * allowlisted host binds, and a git stack's binds from its repo.
 *
 * Mounts are otherwise a create-time seed that the user owns afterwards, and
 * that rule is right for the mounts a user can actually manage. An allowlisted
 * host bind is not one of those: it is a platform grant (see lib/host-binds.ts)
 * that the compose file requests and the platform decides to honour. Leaving it
 * create-only meant every stack deployed before the grant existed stayed broken
 * through any number of redeploys: the Dozzle stacks already out there would
 * have needed deleting and re-adding to pick up their socket.
 *
 * A git stack's repo binds are the same shape. They are copies the build
 * stages out of the checkout on EVERY deploy, into a folder only the platform
 * writes (`composeRepoBindDir`), and the file names them; nothing about them
 * is the user's to manage. Seeding them only on create left every git stack
 * whose children predate staged repo binds without them forever: a redeploy
 * refreshed the copies and mounted none of them.
 *
 * Additive on purpose: each bind is upserted on its own `(service, target)` key,
 * so mounts the user added in the Settings tab are untouched. Only paths the
 * file asks for AND the platform resolved (an allowlist grant, or a source the
 * build staged from the repo) are written, so this can never mount something
 * the compose did not name.
 */
async function ensurePlatformBinds(
  resourceId: ResourceId,
  mounts: ReturnType<typeof toServiceFields>["mounts"],
  ctx: Pick<StackReconcileContext, "hostBindGrants" | "repoBindSources" | "stackDir">,
): Promise<void> {
  for (const m of mounts) {
    if (m.type !== "bind" || !m.source) continue;
    if (!allowedHostBind(m.source, ctx.hostBindGrants) && !isStagedRepoBind(m.source, ctx)) {
      continue;
    }
    await upsertServiceMount({
      serviceResourceId: resourceId,
      type: "bind",
      target: m.target,
      source: m.source,
      content: null,
      readOnly: m.readOnly,
    });
  }
}

/** A bind `toMounts` resolved into a git stack's staged repo copy. Only a git
 *  stack carries `repoBindSources`, and only its staged sources resolve under
 *  `stackDir`, so an inline stack's user-seeded binds never match. */
function isStagedRepoBind(
  source: string,
  ctx: Pick<StackReconcileContext, "repoBindSources" | "stackDir">,
): boolean {
  if (!ctx.repoBindSources || !ctx.stackDir) return false;
  return source.startsWith(`${ctx.stackDir.replace(/\/+$/, "")}/`);
}

export /**
 * Bring ONE compose service's `service_resource` row in line with the file:
 * update the existing row's structure, or create it (plus its one-time seeds)
 * the first time the service is materialized.
 *
 * Split out of {@link reconcileStackServices} because the create/update fork
 * and the two "seeded once on create, user-owned from then on" rules that hang
 * off it (env, bind mounts) are a self-contained decision. The reconcile loop
 * only needs the resulting `(resourceId, isCreate)` pair, and every branch kept
 * inline there competes for attention with the per-service crash tolerance the
 * loop itself exists to provide.
 */
async function materializeServiceRow(input: {
  ctx: StackReconcileContext;
  composeServiceName: string;
  mapped: ReturnType<typeof toServiceFields>;
  existingResourceId: ResourceId | undefined;
  /** The existing row's stored hostname, when updating one. */
  existingInternalHostname?: string;
  /** The owning stack's environment. A child belongs wherever its stack does.
   *  Read from the stack row rather than threaded through every context
   *  construction site, so it cannot go missing on one path and it follows the
   *  stack if that ever moves. */
  environmentId: EnvironmentId | null;
  /** Owning stack's resource name. Children are namespaced by it. */
  stackResourceName: string;
}): Promise<{ resourceId: ResourceId; isCreate: boolean; internalHostname: string }> {
  const { ctx, mapped } = input;
  if (input.existingResourceId) {
    // Structure (image/command/replicas/healthcheck/resources) tracks the
    // file. Env + ports + name are left alone. The user owns env post-create.
    // composeService rides along so pre-column children (NULL after the
    // backfill missed them) heal on their next reconcile.
    await updateServiceRecord(input.existingResourceId, {
      ...mapped.fields,
      composeService: input.composeServiceName,
    });
    await ensurePlatformBinds(input.existingResourceId, mapped.mounts, ctx);
    // The stored hostname, not the mapped bare one: an existing child may have
    // been renamed on ITS create, and the rename map the caller builds has to
    // describe what DNS actually answers.
    return {
      resourceId: input.existingResourceId,
      isCreate: false,
      internalHostname: input.existingInternalHostname ?? mapped.internalHostname,
    };
  }

  const name = await pickResourceName(
    ctx.projectId,
    input.composeServiceName,
    input.stackResourceName,
  );
  // Collision-aware: the mapped hostname is the bare compose name, which a
  // sibling stack (or a standalone service) may already own on this shared
  // network. See pickInternalHostname.
  const internalHostname = await pickInternalHostname(
    mapped.networkName,
    input.composeServiceName,
    input.stackResourceName,
  );
  const created = await createServiceRecord({
    projectId: ctx.projectId,
    environmentId: input.environmentId,
    name,
    status: "draft",
    // Create-time only, by construction: this branch IS the create. An
    // existing child is updated above and never has its placement touched,
    // so a service an operator moved on its own Settings tab stays moved.
    placementServerId: ctx.placementServerId,
    source: "image",
    internalHostname,
    serviceName: mapped.serviceName,
    networkName: mapped.networkName,
    stackId: ctx.stackResourceId,
    composeService: input.composeServiceName,
    ports: mapped.ports,
    env: mapped.env,
    ...mapped.fields,
  });
  const resourceId = created.resource.id;
  // Seed bind mounts (multi-file inline stacks) ONCE, on create. Mirroring
  // the env "user owns it post-create" convention, so a later compose edit
  // never clobbers user-managed mounts and existing stacks are untouched.
  if (mapped.mounts.length > 0) {
    await bulkReplaceServiceMounts(resourceId, mapped.mounts);
  }
  return { resourceId, isCreate: true, internalHostname };
}
