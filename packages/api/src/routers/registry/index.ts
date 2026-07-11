/**
 * Container registry router. Org-scoped CRUD over container_registry
 * rows. Plaintext passwords flow in on create/update and are encrypted
 * before INSERT — see queries.ts for the boundary.
 */

import { orgScopedProcedure, requirePermission } from "../..";
import { isUniqueViolation } from "../project/views";
import { fetchRegistryTags, parseImageRef } from "./list-tags";
import {
  canonicalizeHost,
  createRegistryRecord,
  deleteRegistryRecord,
  findRegistryByOrgHostUser,
  getRegistryCredentialForOrg,
  getRegistryCredentialForOrgByHost,
  getRegistryForOrg,
  listRegistriesForOrg,
  updateRegistryRecord,
} from "./queries";
import { probeRegistry } from "./test-connection";

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

  /**
   * Docker Registry v2 handshake. With an `id`, stored credentials are
   * used (inline username/password act as overrides — the dialog's edit
   * flow sends a new password before it's saved). Without an id, the
   * inline host/username/password are probed for pre-save "Test & save".
   * Probe failures come back as `{ok: false, message}` — only a missing
   * stored credential is an RPC error.
   */
  testConnection: requirePermission({ registry: ["read"] }).registry.testConnection.handler(
    async ({ input, context, errors }) => {
      let host: string;
      let username: string;
      let password: string;

      if (input.id !== undefined) {
        const stored = await getRegistryCredentialForOrg(context.activeOrganizationId, input.id);
        if (!stored) throw errors.NOT_FOUND();
        host = stored.host;
        username =
          input.username !== undefined && input.username.length > 0
            ? input.username
            : stored.username;
        password =
          input.password !== undefined && input.password.length > 0
            ? input.password
            : stored.password;
        context.log.set({ target: { type: "container_registry", id: input.id, host } });
      } else {
        host = canonicalizeHost(input.host ?? "");
        username = input.username ?? "";
        password = input.password ?? "";
        context.log.set({ target: { type: "container_registry", host } });
      }

      const result = await probeRegistry({ host, username, password });
      if (result.isErr()) {
        return { ok: false, status: result.error.status, message: result.error.message };
      }
      return { ok: true, status: result.value.status, message: result.value.message };
    },
  ),

  /**
   * Docker Registry v2 tag listing for the wizard's tag browser. With a
   * `registryId`, the stored credential is used — but only when its host
   * matches the image's registry (sending a GHCR token to Docker Hub
   * would be both useless and leaky). Without one, a stored credential
   * for the image's host is auto-matched exactly like deploy-time pull
   * auth (`resolveRegistryAuth`), falling back to anonymous. Listing
   * failures (rate limits, private repos, unreachable hosts) come back
   * as `{ok: false, message}` — only a missing stored credential throws.
   */
  listTags: requirePermission({ registry: ["read"] }).registry.listTags.handler(
    async ({ input, context, errors }) => {
      const failure = (message: string, status?: number) => ({
        ok: false,
        tags: [],
        truncated: false,
        message,
        ...(status !== undefined && { status }),
      });

      const ref = parseImageRef(input.image);
      if (!ref) {
        return failure(`"${input.image}" is not a valid image reference`);
      }

      let username = "";
      let password = "";
      if (input.registryId !== undefined) {
        const stored = await getRegistryCredentialForOrg(
          context.activeOrganizationId,
          input.registryId,
        );
        if (!stored) throw errors.NOT_FOUND();
        if (stored.host !== ref.host) {
          return failure(
            `The selected credential is for ${stored.host}, but ${input.image} lives on ${ref.host} — pick a matching registry or anonymous pull`,
          );
        }
        username = stored.username;
        password = stored.password;
        context.log.set({
          target: { type: "container_registry", id: input.registryId, host: stored.host },
        });
      } else {
        const stored = await getRegistryCredentialForOrgByHost(
          context.activeOrganizationId,
          ref.host,
        );
        if (stored) {
          username = stored.username;
          password = stored.password;
        }
        context.log.set({ target: { type: "container_registry", host: ref.host } });
      }

      const result = await fetchRegistryTags({
        host: ref.host,
        repository: ref.repository,
        username,
        password,
      });
      if (result.isErr()) {
        return failure(result.error.message, result.error.status);
      }
      return { ok: true, tags: result.value.tags, truncated: result.value.truncated };
    },
  ),
};
