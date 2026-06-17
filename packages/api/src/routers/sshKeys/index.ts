import { matchError } from "better-result";

import { requirePermission } from "../..";

import {
  deleteSshKey,
  generateSshKey,
  importSshKey,
  listSshKeys,
  rotateSshKey,
} from "./handlers";
import type { SshKeyRecord } from "./queries";
import type { sshKeySchema } from "./contract";
import type * as z from "zod";

type SshKeyPublic = z.infer<typeof sshKeySchema>;

/**
 * Map a DB row to the public wire shape — drops `privateKeyCiphertext`
 * entirely and surfaces `hasPrivateKey` instead. `usedBy` is empty for now:
 * the Git-provider / node / service subsystems don't yet reference keys, so
 * reporting usage would be fiction. Wired in when those consumers land.
 */
function toPublic(row: SshKeyRecord): SshKeyPublic {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    bits: row.bits,
    publicKey: row.publicKey,
    fingerprint: row.fingerprint,
    comment: row.comment,
    imported: row.imported,
    hasPrivateKey: row.privateKeyCiphertext != null,
    usedBy: [],
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const sshKeysRouter = {
  list: requirePermission({ sshKey: ["read"] }).sshKeys.list.handler(
    async ({ context }) => {
      const rows = await listSshKeys({
        organizationId: context.activeOrganizationId,
      });
      return rows.map(toPublic);
    },
  ),

  generate: requirePermission({ sshKey: ["create"] }).sshKeys.generate.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "sshKey" } });
      const result = await generateSshKey({
        ...input,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          SshKeyConflictError: () => errors.CONFLICT(),
        });
      }
      context.log.set({ target: { type: "sshKey", id: result.value.id } });
      return toPublic(result.value);
    },
  ),

  import: requirePermission({ sshKey: ["create"] }).sshKeys.import.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "sshKey" } });
      const result = await importSshKey({
        ...input,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          SshKeyConflictError: () => errors.CONFLICT(),
          SshKeyImportError: (e) => errors.INVALID_INPUT({ message: e.message }),
        });
      }
      context.log.set({ target: { type: "sshKey", id: result.value.id } });
      return toPublic(result.value);
    },
  ),

  rotate: requirePermission({ sshKey: ["update"] }).sshKeys.rotate.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "sshKey", id: input.id } });
      const result = await rotateSshKey({
        id: input.id,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          SshKeyNotFoundError: () => errors.NOT_FOUND(),
          SshKeyNotRotatableError: (e) => errors.INVALID_INPUT({ message: e.message }),
          SshKeyConflictError: () => errors.CONFLICT(),
        });
      }
      return toPublic(result.value);
    },
  ),

  delete: requirePermission({ sshKey: ["delete"] }).sshKeys.delete.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "sshKey", id: input.id } });
      const result = await deleteSshKey({
        id: input.id,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          SshKeyNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),
};
