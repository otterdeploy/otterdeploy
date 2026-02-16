import * as z from "zod";
import { db, eq } from "@otterstack/db";
import { projectEnvironment } from "@otterstack/db/schema/architecture";

import { orgProcedure, orgMemberProcedure, orgAdminProcedure } from "../index";
import { createId } from "../utils/helpers";
import { validateProjectAccess, validateEnvironmentAccess } from "../utils/ownership";

function formatEnvironment(row: typeof projectEnvironment.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const environmentRouter = {
  create: orgMemberProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        name: z.string().min(1).max(64),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateProjectAccess(input.projectId, context.organizationId);

      const now = new Date();
      const env = {
        id: createId(),
        projectId: input.projectId,
        name: input.name,
        createdAt: now,
        updatedAt: now,
      };

      await db.insert(projectEnvironment).values(env);
      return formatEnvironment(env);
    }),

  getById: orgProcedure
    .input(
      z.object({
        environmentId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      const row = await validateEnvironmentAccess(input.environmentId, context.organizationId);
      return formatEnvironment(row);
    }),

  list: orgProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateProjectAccess(input.projectId, context.organizationId);

      const rows = await db.query.projectEnvironment.findMany({
        where: eq(projectEnvironment.projectId, input.projectId),
      });

      return rows.map(formatEnvironment);
    }),

  delete: orgAdminProcedure
    .input(
      z.object({
        environmentId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateEnvironmentAccess(input.environmentId, context.organizationId);
      await db.delete(projectEnvironment).where(eq(projectEnvironment.id, input.environmentId));
      return { success: true as const };
    }),
};
