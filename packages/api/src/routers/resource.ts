import * as z from "zod";
import { ORPCError } from "@orpc/server";
import { db, eq, inArray } from "@otterstack/db";
import {
  projectResource,
  projectEnvironment,
} from "@otterstack/db/schema/architecture";

import { orgProcedure, orgMemberProcedure, orgAdminProcedure } from "../index";
import { createId } from "../utils/helpers";
import { validateProjectAccess, validateEnvironmentInProject, validateResourceAccess } from "../utils/ownership";

function formatResource(
  row: typeof projectResource.$inferSelect,
  projectId: string,
) {
  return {
    id: row.id,
    projectId,
    environmentId: row.environmentId,
    name: row.name,
    kind: row.kind,
    status: row.status,
    metadata: row.metadata,
    posX: row.posX,
    posY: row.posY,
    buildMethod: row.buildMethod ?? null,
    dockerfilePath: row.dockerfilePath ?? null,
    port: row.port ?? null,
    healthCheckPath: row.healthCheckPath ?? null,
    replicas: row.replicas ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const resourceRouter = {
  create: orgMemberProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        environmentId: z.string().min(1),
        name: z.string().min(1).max(128),
        kind: z.enum(["web", "api", "worker", "database", "cache", "volume"]),
        status: z.enum(["online", "degraded", "crashed", "unknown", "deploying", "stopped"]).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        posX: z.number(),
        posY: z.number(),
        buildMethod: z.enum(["nixpacks", "dockerfile", "buildpack"]).optional(),
        dockerfilePath: z.string().optional(),
        port: z.number().int().optional(),
        healthCheckPath: z.string().optional(),
        replicas: z.number().int().min(1).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateEnvironmentInProject(input.environmentId, input.projectId, context.organizationId);

      const now = new Date();
      const resource = {
        id: createId(),
        environmentId: input.environmentId,
        kind: input.kind,
        name: input.name,
        status: input.status ?? ("unknown" as const),
        metadata: input.metadata ?? {},
        posX: input.posX,
        posY: input.posY,
        buildMethod: input.buildMethod,
        dockerfilePath: input.dockerfilePath,
        port: input.port,
        healthCheckPath: input.healthCheckPath,
        replicas: input.replicas,
        createdAt: now,
        updatedAt: now,
      };

      await db.insert(projectResource).values(resource);

      return formatResource(resource as typeof projectResource.$inferSelect, input.projectId);
    }),

  getById: orgProcedure
    .input(
      z.object({
        resourceId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      const row = await validateResourceAccess(input.resourceId, context.organizationId);
      return formatResource(row, row.environment.project.id);
    }),

  list: orgProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        environmentId: z.string().min(1).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateProjectAccess(input.projectId, context.organizationId);

      if (input.environmentId) {
        const rows = await db.query.projectResource.findMany({
          where: eq(projectResource.environmentId, input.environmentId),
        });
        return rows.map((r) => formatResource(r, input.projectId));
      }

      const environments = await db.query.projectEnvironment.findMany({
        where: eq(projectEnvironment.projectId, input.projectId),
        columns: { id: true },
      });

      const envIds = environments.map((e) => e.id);
      if (envIds.length === 0) return [];

      const rows = await db.query.projectResource.findMany({
        where: inArray(projectResource.environmentId, envIds),
      });

      return rows.map((r) => formatResource(r, input.projectId));
    }),

  update: orgMemberProcedure
    .input(
      z.object({
        resourceId: z.string().min(1),
        name: z.string().min(1).max(128).optional(),
        kind: z.enum(["web", "api", "worker", "database", "cache", "volume"]).optional(),
        status: z.enum(["online", "degraded", "crashed", "unknown", "deploying", "stopped"]).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        posX: z.number().optional(),
        posY: z.number().optional(),
        buildMethod: z.enum(["nixpacks", "dockerfile", "buildpack"]).nullable().optional(),
        dockerfilePath: z.string().nullable().optional(),
        port: z.number().int().nullable().optional(),
        healthCheckPath: z.string().nullable().optional(),
        replicas: z.number().int().min(1).nullable().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const existing = await validateResourceAccess(input.resourceId, context.organizationId);
      const projectId = existing.environment.project.id;

      const updates: Partial<typeof projectResource.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.name !== undefined) updates.name = input.name;
      if (input.kind !== undefined) updates.kind = input.kind;
      if (input.status !== undefined) updates.status = input.status;
      if (input.metadata !== undefined) updates.metadata = input.metadata;
      if (input.posX !== undefined) updates.posX = input.posX;
      if (input.posY !== undefined) updates.posY = input.posY;
      if (input.buildMethod !== undefined) updates.buildMethod = input.buildMethod ?? undefined;
      if (input.dockerfilePath !== undefined) updates.dockerfilePath = input.dockerfilePath ?? undefined;
      if (input.port !== undefined) updates.port = input.port ?? undefined;
      if (input.healthCheckPath !== undefined) updates.healthCheckPath = input.healthCheckPath ?? undefined;
      if (input.replicas !== undefined) updates.replicas = input.replicas ?? undefined;

      await db.update(projectResource).set(updates).where(eq(projectResource.id, input.resourceId));

      const updated = await db.query.projectResource.findFirst({
        where: eq(projectResource.id, input.resourceId),
      });
      if (!updated) throw new ORPCError("NOT_FOUND", { message: "Resource not found" });

      return formatResource(updated, projectId);
    }),

  delete: orgAdminProcedure
    .input(
      z.object({
        resourceId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateResourceAccess(input.resourceId, context.organizationId);
      await db.delete(projectResource).where(eq(projectResource.id, input.resourceId));
      return { success: true as const };
    }),
};
