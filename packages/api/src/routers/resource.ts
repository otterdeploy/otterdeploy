import * as z from "zod";
import { ORPCError } from "@orpc/server";
import { db, eq, inArray } from "@otterdeploy/db";
import { resource, environment, resourcePosition } from "@otterdeploy/db/schema/project";
import { resourceRuntimeConfig, resourceBuildConfig, databaseConfig } from "@otterdeploy/db/schema/resource-config";
import { deployment, deploymentEvent } from "@otterdeploy/db/schema/deployment";

import { pickDefined } from "@otterdeploy/domain";
import { publishEvent } from "@otterdeploy/events";

import { orgProcedure, orgMemberProcedure, orgAdminProcedure } from "../index";
import { createId } from "../utils/helpers";
import {
  validateProjectAccess,
  validateEnvironmentInProject,
  validateResourceAccess,
} from "../utils/ownership";

type ResourceRow = typeof resource.$inferSelect & {
  position?: typeof resourcePosition.$inferSelect | null;
  runtimeConfig?: typeof resourceRuntimeConfig.$inferSelect | null;
  buildConfig?: typeof resourceBuildConfig.$inferSelect | null;
};

function formatResource(row: ResourceRow, projectId: string) {
  return {
    id: row.id,
    projectId,
    environmentId: row.environmentId,
    name: row.name,
    kind: row.kind,
    status: row.status,
    posX: row.position?.posX ?? 0,
    posY: row.position?.posY ?? 0,
    builder: row.buildConfig?.builder ?? null,
    dockerfilePath: row.buildConfig?.dockerfilePath ?? null,
    port: row.runtimeConfig?.port ?? null,
    healthCheckPath: row.runtimeConfig?.healthCheckPath ?? null,
    replicas: row.runtimeConfig?.replicas ?? null,
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
        kind: z.enum(["web", "api", "worker", "database", "compose"]),
        status: z
          .enum(["online", "degraded", "crashed", "unknown", "deploying", "stopped"])
          .optional(),
        posX: z.number(),
        posY: z.number(),
        builder: z.enum(["nixpacks", "dockerfile", "buildpack"]).optional(),
        dockerfilePath: z.string().optional(),
        port: z.number().int().optional(),
        healthCheckPath: z.string().optional(),
        replicas: z.number().int().min(1).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateEnvironmentInProject(
        input.environmentId,
        input.projectId,
        context.organizationId,
      );

      const now = new Date();
      const resourceId = createId();

      const [inserted] = await db
        .insert(resource)
        .values({
          id: resourceId,
          organizationId: context.organizationId,
          projectId: input.projectId,
          environmentId: input.environmentId,
          kind: input.kind,
          name: input.name,
          status: input.status ?? ("unknown" as const),
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!inserted) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to create resource" });
      }

      // Insert into extension tables
      await db.insert(resourcePosition).values({
        resourceId,
        posX: input.posX,
        posY: input.posY,
      });

      if (input.builder || input.dockerfilePath) {
        await db.insert(resourceBuildConfig).values({
          id: createId(),
          resourceId,
          builder: input.builder,
          dockerfilePath: input.dockerfilePath,
        });
      }

      if (input.port || input.healthCheckPath || input.replicas) {
        await db.insert(resourceRuntimeConfig).values({
          id: createId(),
          resourceId,
          port: input.port,
          healthCheckPath: input.healthCheckPath,
          replicas: input.replicas,
        });
      }

      // Re-fetch with relations to return full formatted resource
      const full = await db.query.resource.findFirst({
        where: eq(resource.id, resourceId),
        with: { position: true, runtimeConfig: true, buildConfig: true },
      });

      return formatResource(full!, input.projectId);
    }),

  getById: orgProcedure
    .input(
      z.object({
        resourceId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      // Validate access first
      await validateResourceAccess(input.resourceId, context.organizationId);
      // Re-fetch with config relations
      const row = await db.query.resource.findFirst({
        where: eq(resource.id, input.resourceId),
        with: {
          environment: { with: { project: true } },
          position: true,
          runtimeConfig: true,
          buildConfig: true,
        },
      });
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Resource not found" });
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

      const withRelations = { position: true, runtimeConfig: true, buildConfig: true } as const;

      if (input.environmentId) {
        const rows = await db.query.resource.findMany({
          where: eq(resource.environmentId, input.environmentId),
          with: withRelations,
        });
        return rows.map((r) => formatResource(r, input.projectId));
      }

      const environments = await db.query.environment.findMany({
        where: eq(environment.projectId, input.projectId),
        columns: { id: true },
      });

      const envIds = environments.map((e) => e.id);
      if (envIds.length === 0) return [];

      const rows = await db.query.resource.findMany({
        where: inArray(resource.environmentId, envIds),
        with: withRelations,
      });

      return rows.map((r) => formatResource(r, input.projectId));
    }),

  update: orgMemberProcedure
    .input(
      z.object({
        resourceId: z.string().min(1),
        name: z.string().min(1).max(128).optional(),
        kind: z.enum(["web", "api", "worker", "database", "compose"]).optional(),
        status: z
          .enum(["online", "degraded", "crashed", "unknown", "deploying", "stopped"])
          .optional(),
        posX: z.number().optional(),
        posY: z.number().optional(),
        builder: z.enum(["nixpacks", "dockerfile", "buildpack"]).nullable().optional(),
        dockerfilePath: z.string().nullable().optional(),
        port: z.number().int().nullable().optional(),
        healthCheckPath: z.string().nullable().optional(),
        replicas: z.number().int().min(1).nullable().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const existing = await validateResourceAccess(input.resourceId, context.organizationId);
      const projectId = existing.environment.project.id;

      // Update core resource fields
      const coreFields = pickDefined({
        name: input.name,
        kind: input.kind,
        status: input.status,
      });
      if (Object.keys(coreFields).length > 0) {
        await db.update(resource).set(coreFields).where(eq(resource.id, input.resourceId));
      }

      // Update position if provided
      if (input.posX !== undefined || input.posY !== undefined) {
        const posFields = pickDefined({ posX: input.posX, posY: input.posY });
        await db
          .insert(resourcePosition)
          .values({ resourceId: input.resourceId, ...posFields })
          .onConflictDoUpdate({
            target: resourcePosition.resourceId,
            set: posFields,
          });
      }

      // Update build config if provided
      if (input.builder !== undefined || input.dockerfilePath !== undefined) {
        const buildFields = pickDefined({
          builder: input.builder,
          dockerfilePath: input.dockerfilePath,
        });
        await db
          .insert(resourceBuildConfig)
          .values({ id: createId(), resourceId: input.resourceId, ...buildFields })
          .onConflictDoUpdate({
            target: resourceBuildConfig.resourceId,
            set: buildFields,
          });
      }

      // Update runtime config if provided
      if (input.port !== undefined || input.healthCheckPath !== undefined || input.replicas !== undefined) {
        const runtimeFields = pickDefined({
          port: input.port,
          healthCheckPath: input.healthCheckPath,
          replicas: input.replicas,
        });
        await db
          .insert(resourceRuntimeConfig)
          .values({ id: createId(), resourceId: input.resourceId, ...runtimeFields })
          .onConflictDoUpdate({
            target: resourceRuntimeConfig.resourceId,
            set: runtimeFields,
          });
      }

      const updated = await db.query.resource.findFirst({
        where: eq(resource.id, input.resourceId),
        with: { position: true, runtimeConfig: true, buildConfig: true },
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
      const existing = await validateResourceAccess(input.resourceId, context.organizationId);

      const publishResult = await publishEvent("resource.deleted", {
        orgId: context.organizationId,
        projectId: existing.projectId,
        environmentId: existing.environmentId,
        resourceId: existing.id,
      });
      if (publishResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to schedule resource cleanup",
        });
      }

      await db.delete(resource).where(eq(resource.id, input.resourceId));
      return { success: true as const };
    }),

  provision: orgMemberProcedure
    .input(
      z.object({
        resourceId: z.string().min(1),
        databaseEngine: z
          .enum(["postgresql", "mysql", "mariadb", "mongodb", "redis", "keydb", "dragonfly", "clickhouse"])
          .optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const row = await validateResourceAccess(input.resourceId, context.organizationId);
      const projectId = row.environment.project.id;
      const environmentId = row.environment.id;
      const now = new Date();
      let provisionDeploymentId: string | null = null;

      // Persist database provisions as deployments so they appear in history.
      if (row.kind === "database") {
        provisionDeploymentId = createId();
        await db.insert(deployment).values({
          id: provisionDeploymentId,
          organizationId: context.organizationId,
          projectId,
          environmentId,
          resourceId: input.resourceId,
          status: "queued",
          source: "manual",
          gitRef: null,
          gitCommitSha: null,
          gitCommitMessage: null,
          builder: null,
          imageTag: null,
          previousImageTag: null,
          startedAt: null,
          completedAt: null,
          duration: null,
          triggeredBy: context.userId,
          idempotencyKey: null,
          createdAt: now,
          updatedAt: now,
        });

        await db.insert(deploymentEvent).values({
          id: createId(),
          deploymentId: provisionDeploymentId,
          status: "queued",
          previousStatus: null,
          actor: context.userId,
          reason: "Resource provision requested",
          metadata: { trigger: "resource.provision" },
          createdAt: now,
        });
      }

      // Create database config server-side so it's in Postgres before the worker reads it
      if (row.kind === "database" && input.databaseEngine) {
        const DATABASE_DEFAULT_IMAGES: Record<string, string> = {
          postgresql: "postgres:16",
          mysql: "mysql:8",
          mariadb: "mariadb:11",
          mongodb: "mongo:7",
          redis: "redis:7-alpine",
          keydb: "eqalpha/keydb:latest",
          dragonfly: "docker.dragonflydb.io/dragonflydb/dragonfly:latest",
          clickhouse: "clickhouse/clickhouse-server:latest",
        };

        await db
          .insert(databaseConfig)
          .values({
            id: createId(),
            resourceId: input.resourceId,
            databaseType: input.databaseEngine,
            image: DATABASE_DEFAULT_IMAGES[input.databaseEngine] ?? "",
          })
          .onConflictDoUpdate({
            target: databaseConfig.resourceId,
            set: {
              databaseType: input.databaseEngine,
              image: DATABASE_DEFAULT_IMAGES[input.databaseEngine] ?? "",
            },
          });
      }

      // Mark resource as deploying
      await db
        .update(resource)
        .set({ status: "deploying", updatedAt: now })
        .where(eq(resource.id, input.resourceId));

      await publishEvent("resource.created", {
        orgId: context.organizationId,
        projectId,
        environmentId,
        resourceId: input.resourceId,
        deploymentId: provisionDeploymentId ?? undefined,
        kind: row.kind,
        status: "deploying",
      });

      return {
        success: true as const,
        deploymentId: provisionDeploymentId,
      };
    }),
};
