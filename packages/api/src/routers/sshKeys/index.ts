import type * as z from "zod";

import { matchError } from "better-result";

import type { sshKeySchema } from "./contract";
import type { SshKeyView } from "./usage";

import { requirePermission } from "../..";
import { deleteSshKey, generateSshKey, importSshKey, listSshKeys } from "./handlers";
import { rotateSshKey } from "./rotate";

type SshKeyPublic = z.infer<typeof sshKeySchema>;

/**
 * Map a key (with its derived usage) to the public wire shape. Drops
 * `privateKeyCiphertext` entirely and surfaces `hasPrivateKey` instead.
 * `usedBy` is the servers whose `ssh_key_id` points at the key: the node
 * reconciler and firewall remediation sign in to them with it.
 */
function toPublic(row: SshKeyView): SshKeyPublic {
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
    usedBy: row.usedBy,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const sshKeysRouter = {
  list: requirePermission({ sshKey: ["read"] }).sshKeys.list.handler(async ({ context }) => {
    const rows = await listSshKeys({
      organizationId: context.activeOrganizationId,
    });
    return rows.map(toPublic);
  }),

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
      // A key that was just created has no server using it yet.
      return toPublic({ ...result.value, usedBy: [] });
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
      return toPublic({ ...result.value, usedBy: [] });
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
          SshKeyChangedError: (e) => errors.CONFLICT({ message: e.message }),
          SshKeyRotateFailedError: (e) =>
            errors.ROTATE_FAILED({ message: e.message, data: { servers: e.servers } }),
        });
      }
      return { ...toPublic(result.value.key), servers: result.value.servers };
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
          SshKeyInUseError: (e) =>
            errors.IN_USE({ message: e.message, data: { servers: e.servers } }),
        });
      }
      return result.value;
    },
  ),
};
