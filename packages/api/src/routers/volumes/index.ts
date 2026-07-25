/**
 * Installation-admin view over the daemon's named volumes, enriched with the
 * owning platform resource. Host-wide inventory and mutations never inherit
 * authority from an organization role.
 */
import { requireInstallAdmin } from "../..";
import { createVolume, inspectVolume, listEnrichedVolumes, removeVolume } from "./service";

export const volumesRouter = {
  list: requireInstallAdmin().volumes.list.handler(async ({ context, errors }) => {
    const result = await listEnrichedVolumes(context.activeOrganizationId);
    if (!result.ok) throw errors.SERVER_ERROR({ message: result.reason });
    return result.items;
  }),

  inspect: requireInstallAdmin().volumes.inspect.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "docker_volume", name: input.name } });
    const result = await inspectVolume(input.name);
    if (!result.ok) {
      if (result.kind === "not-found") throw errors.NOT_FOUND();
      throw errors.SERVER_ERROR({ message: result.reason });
    }
    const user = context.session?.user;
    if (user) {
      context.log.audit?.({
        action: "volumes.inspect",
        actor: { type: "user", id: user.id, email: user.email },
        outcome: "success",
      });
    }
    return { details: result.details };
  }),

  create: requireInstallAdmin().volumes.create.handler(async ({ input, context, errors }) => {
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
  }),

  remove: requireInstallAdmin().volumes.remove.handler(async ({ input, context, errors }) => {
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
  }),
};
