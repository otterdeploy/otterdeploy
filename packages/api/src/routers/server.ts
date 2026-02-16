import * as z from "zod";
import { db, eq } from "@otterstack/db";
import { server, sshKey } from "@otterstack/db/schema/infrastructure";
import { upsertSecretReference } from "@otterstack/secrets";

import { orgProcedure, orgAdminStepUpProcedure } from "../index";
import { writeAuditLogEvent } from "../utils/audit";
import { createId, toISOString } from "../utils/helpers";
import { encodeLegacySecret } from "../utils/legacy-secret";
import { validateServerAccess } from "../utils/ownership";

function formatServer(row: typeof server.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    ipAddress: row.ipAddress,
    port: row.port,
    status: row.status,
    role: row.role,
    sshKeyId: row.sshKeyId ?? null,
    lastSeenAt: toISOString(row.lastSeenAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const serverRouter = {
  register: orgAdminStepUpProcedure
    .input(
      z.object({
        organizationId: z.string().min(1).optional(),
        name: z.string().min(1).max(128),
        ipAddress: z.string().min(1),
        port: z.number().int().min(1).max(65535).default(22),
        role: z.enum(["manager", "worker"]).default("worker"),
        ssh: z
          .object({
            name: z.string().min(1).max(128),
            publicKey: z.string().min(1),
            privateKey: z.string().min(1),
            fingerprint: z.string().min(1),
          })
          .optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const now = new Date();
      let sshKeyId: string | null = null;

      if (input.ssh) {
        const sshSecret = await upsertSecretReference({
          organizationId: context.organizationId,
          kind: "ssh_private_key",
          logicalScope: "organization",
          logicalScopeId: context.organizationId,
          key: `server.${input.ipAddress}.${input.port}.ssh_private_key`,
          plaintext: input.ssh.privateKey,
          actorUserId: context.userId,
        });

        const sshRow = {
          id: createId(),
          organizationId: context.organizationId,
          name: input.ssh.name,
          publicKey: input.ssh.publicKey,
          privateKeySecretReferenceId: sshSecret.reference.id,
          encryptedPrivateKey: encodeLegacySecret(input.ssh.privateKey),
          fingerprint: input.ssh.fingerprint,
          createdAt: now,
        };

        await db.insert(sshKey).values(sshRow);
        sshKeyId = sshRow.id;
      }

      const row = {
        id: createId(),
        organizationId: context.organizationId,
        name: input.name,
        ipAddress: input.ipAddress,
        port: input.port,
        sshKeyId,
        status: "disconnected" as const,
        role: input.role,
        lastSeenAt: null,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      };

      await db.insert(server).values(row);

      await writeAuditLogEvent({
        organizationId: context.organizationId,
        userId: context.userId,
        action: "server.registered",
        entityType: "server",
        entityId: row.id,
        metadata: {
          sshAttached: !!sshKeyId,
        },
        headers: context.headers,
      });

      return formatServer(row as typeof server.$inferSelect);
    }),

  list: orgProcedure
    .input(
      z.object({
        organizationId: z.string().min(1).optional(),
      }),
    )
    .handler(async ({ context }) => {
      const rows = await db.query.server.findMany({
        where: eq(server.organizationId, context.organizationId),
      });
      return rows.map(formatServer);
    }),

  test: orgProcedure
    .input(
      z.object({
        serverId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateServerAccess(input.serverId, context.organizationId);
      return {
        serverId: input.serverId,
        status: "offline" as const,
        roundTripMs: null,
      };
    }),

  remove: orgAdminStepUpProcedure
    .input(
      z.object({
        serverId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateServerAccess(input.serverId, context.organizationId);
      await db.delete(server).where(eq(server.id, input.serverId));

      await writeAuditLogEvent({
        organizationId: context.organizationId,
        userId: context.userId,
        action: "server.removed",
        entityType: "server",
        entityId: input.serverId,
        metadata: {},
        headers: context.headers,
      });

      return { success: true as const };
    }),
};
