/**
 * Volumes router — org-scoped view over the daemon's named volumes, enriched
 * with the owning platform resource (see mapping.ts) plus create / inspect /
 * remove lifecycle.
 *
 * RBAC: reads are org-scoped like the server router's; mutations gate on
 * `server:update` — volumes are host-level storage, so mutating them is a
 * server-administration action (there is no dedicated `volume` statement in
 * the access-control vocabulary, and inventing one belongs to the auth
 * package, not here).
 */
import { orgScopedProcedure, requirePermission } from "../..";
import { createVolume, inspectVolume, listEnrichedVolumes, removeVolume } from "./service";

export const volumesRouter = {
  list: orgScopedProcedure.volumes.list.handler(async ({ context, errors }) => {
    const result = await listEnrichedVolumes(context.activeOrganizationId);
    if (!result.ok) throw errors.SERVER_ERROR({ message: result.reason });
    return result.items;
  }),

  inspect: orgScopedProcedure.volumes.inspect.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "docker_volume", name: input.name } });
    const result = await inspectVolume(input.name);
    if (!result.ok) {
      if (result.kind === "not-found") throw errors.NOT_FOUND();
      throw errors.SERVER_ERROR({ message: result.reason });
    }
    return { raw: result.raw };
  }),

  create: requirePermission({ server: ["update"] }).volumes.create.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "docker_volume", name: input.name } });
      const result = await createVolume({
        name: input.name,
        driver: input.driver,
        labels: input.labels,
      });
      if (!result.ok) {
        if (result.kind === "conflict") throw errors.CONFLICT();
        throw errors.SERVER_ERROR({ message: result.reason });
      }
      return result.volume;
    },
  ),

  remove: requirePermission({ server: ["update"] }).volumes.remove.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "docker_volume", name: input.name } });
      const result = await removeVolume(input.name, context.activeOrganizationId);
      if (!result.ok) {
        if (result.kind === "not-found") throw errors.NOT_FOUND();
        if (result.kind === "conflict") {
          throw errors.IN_USE({ data: { reason: result.reason } });
        }
        throw errors.SERVER_ERROR({ message: result.reason });
      }
      return { ok: true };
    },
  ),
};
