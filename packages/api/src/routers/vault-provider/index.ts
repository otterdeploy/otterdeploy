/**
 * Secret-provider router. Reads are `vaultProvider: ["read"]` (the reference
 * picker needs the provider names); every mutation is admin/owner — the
 * stored credential can read every secret the org points at otterdeploy.
 */

import { requirePermission } from "../..";
import {
  createVaultProviderHandler,
  listVaultSecretNamesHandler,
  removeVaultProviderHandler,
  testVaultProviderHandler,
  toProviderView,
  updateVaultProviderHandler,
  VaultProviderNameTakenError,
} from "./handlers";
import { listVaultProvidersByOrg } from "./queries";

export const vaultProviderRouter = {
  list: requirePermission({ vaultProvider: ["read"] }).vaultProvider.list.handler(
    async ({ context }) => {
      const rows = await listVaultProvidersByOrg(context.activeOrganizationId);
      return rows.map(toProviderView);
    },
  ),

  create: requirePermission({ vaultProvider: ["create"] }).vaultProvider.create.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "vaultProvider" } });
      try {
        const view = await createVaultProviderHandler({
          organizationId: context.activeOrganizationId,
          name: input.name,
          kind: input.kind,
          config: input.config,
          credential: input.credential,
        });
        context.log.set({ vaultProvider: { kind: input.kind, name: input.name } });
        return view;
      } catch (err) {
        if (err instanceof VaultProviderNameTakenError) {
          throw errors.NAME_TAKEN({ message: err.message });
        }
        throw err;
      }
    },
  ),

  update: requirePermission({ vaultProvider: ["update"] }).vaultProvider.update.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "vaultProvider", id: input.id } });
      try {
        const view = await updateVaultProviderHandler({
          id: input.id,
          organizationId: context.activeOrganizationId,
          name: input.name,
          config: input.config,
          credential: input.credential,
        });
        if (!view) throw errors.NOT_FOUND();
        return view;
      } catch (err) {
        if (err instanceof VaultProviderNameTakenError) {
          throw errors.NAME_TAKEN({ message: err.message });
        }
        throw err;
      }
    },
  ),

  remove: requirePermission({ vaultProvider: ["delete"] }).vaultProvider.remove.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "vaultProvider", id: input.id } });
      const removed = await removeVaultProviderHandler({
        id: input.id,
        organizationId: context.activeOrganizationId,
      });
      if (!removed) throw errors.NOT_FOUND();
      return { ok: true as const };
    },
  ),

  test: requirePermission({ vaultProvider: ["update"] }).vaultProvider.test.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "vaultProvider", id: input.id } });
      const result = await testVaultProviderHandler({
        id: input.id,
        organizationId: context.activeOrganizationId,
      });
      if (!result) throw errors.NOT_FOUND();
      return result;
    },
  ),

  listSecretNames: requirePermission({
    vaultProvider: ["read"],
  }).vaultProvider.listSecretNames.handler(async ({ input, context, errors }) => {
    const names = await listVaultSecretNamesHandler({
      id: input.id,
      organizationId: context.activeOrganizationId,
    });
    if (names === null) throw errors.NOT_FOUND();
    return names;
  }),
};
