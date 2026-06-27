/**
 * Container registry router. Org-scoped CRUD over container_registry
 * rows. Plaintext passwords flow in on create/update and are encrypted
 * before INSERT — see queries.ts for the boundary.
 */

import { orgScopedProcedure, requirePermission } from "../..";
import { isUniqueViolation } from "../project/views";
import {
  canonicalizeHost,
  createRegistryRecord,
  deleteRegistryRecord,
  findRegistryByOrgHostUser,
  getRegistryForOrg,
  listRegistriesForOrg,
  updateRegistryRecord,
} from "./queries";

export const registryRouter = {
  list: orgScopedProcedure.registry.list.handler(async ({ context }) => {
    return listRegistriesForOrg(context.activeOrganizationId);
  }),

  create: requirePermission({ registry: ["create"] }).registry.create.handler(
    async ({ input, context, errors }) => {
      const host = canonicalizeHost(input.host);
      // Pre-check the uniqueness so we can return a typed 409 even when
      // the underlying constraint isn't hit (race window) — the catch
      // below covers the actual race.
      const existing = await findRegistryByOrgHostUser(
        context.activeOrganizationId,
        host,
        input.username,
      );
      if (existing) throw errors.CONFLICT();
      try {
        const row = await createRegistryRecord({
          organizationId: context.activeOrganizationId,
          displayName: input.displayName,
          host,
          username: input.username,
          plaintextPassword: input.password,
          authType: input.authType,
        });
        context.log.set({
          target: { type: "container_registry", id: row.id, host: row.host },
        });
        return row;
      } catch (err) {
        if (isUniqueViolation(err)) throw errors.CONFLICT();
        throw err;
      }
    },
  ),

  update: requirePermission({ registry: ["update"] }).registry.update.handler(
    async ({ input, context, errors }) => {
      const existing = await getRegistryForOrg(context.activeOrganizationId, input.id);
      if (!existing) throw errors.NOT_FOUND();
      context.log.set({
        target: { type: "container_registry", id: input.id },
      });
      const updated = await updateRegistryRecord({
        organizationId: context.activeOrganizationId,
        id: input.id,
        displayName: input.displayName,
        username: input.username,
        // Treat empty string the same as omitted — the UI sends "" when
        // the password field is left blank so we don't force a re-prompt.
        plaintextPassword: input.password && input.password.length > 0 ? input.password : undefined,
        authType: input.authType,
      });
      if (!updated) throw errors.NOT_FOUND();
      return updated;
    },
  ),

  delete: requirePermission({ registry: ["delete"] }).registry.delete.handler(
    async ({ input, context, errors }) => {
      const existing = await getRegistryForOrg(context.activeOrganizationId, input.id);
      if (!existing) throw errors.NOT_FOUND();
      context.log.set({
        target: { type: "container_registry", id: input.id },
      });
      const deleted = await deleteRegistryRecord({
        organizationId: context.activeOrganizationId,
        id: input.id,
      });
      if (!deleted) throw errors.NOT_FOUND();
      return { ok: true };
    },
  ),
};
