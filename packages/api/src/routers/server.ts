import * as z from "zod";
import { db, eq } from "@otterstack/db";
import { server } from "@otterstack/db/schema/infrastructure";

import { orgProcedure, orgAdminProcedure } from "../index";
import { createId, toISOString } from "../utils/helpers";
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
    lastSeenAt: toISOString(row.lastSeenAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const serverRouter = {
  register: orgAdminProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        name: z.string().min(1).max(128),
        ipAddress: z.string().min(1),
        port: z.number().int().min(1).max(65535).default(22),
        role: z.enum(["manager", "worker"]).default("worker"),
      }),
    )
    .handler(async ({ context, input }) => {
      const now = new Date();
      const row = {
        id: createId(),
        organizationId: context.organizationId,
        name: input.name,
        ipAddress: input.ipAddress,
        port: input.port,
        status: "disconnected" as const,
        role: input.role,
        lastSeenAt: null,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      };

      await db.insert(server).values(row);
      return formatServer(row as typeof server.$inferSelect);
    }),

  list: orgProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
      }),
    )
    .handler(async ({ context }) => {
      const rows = await db.query.server.findMany({
        where: eq(server.organizationId, context.organizationId),
      });
      return rows.map(formatServer);
    }),

  test: orgAdminProcedure
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

  remove: orgAdminProcedure
    .input(
      z.object({
        serverId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateServerAccess(input.serverId, context.organizationId);
      await db.delete(server).where(eq(server.id, input.serverId));
      return { success: true as const };
    }),
};
