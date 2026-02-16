import * as z from "zod";
import { ORPCError } from "@orpc/server";
import { db, eq, and, desc, sql } from "@otterstack/db";
import { deployment } from "@otterstack/db/schema/deployment";

import {
  orgProcedure,
  orgMemberProcedure,
  orgAdminProcedure,
} from "../index";
import { createId, toISOString, paginationMeta } from "../utils/helpers";
import {
  validateEnvironmentInProject,
  validateResourceInProject,
  validateDeploymentAccess,
} from "../utils/ownership";

function formatDeployment(row: typeof deployment.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    environmentId: row.environmentId,
    resourceId: row.resourceId,
    status: row.status,
    source: row.source,
    buildMethod: row.buildMethod ?? null,
    gitRef: row.gitRef ?? null,
    gitCommitSha: row.gitCommitSha ?? null,
    gitCommitMessage: row.gitCommitMessage ?? null,
    imageTag: row.imageTag ?? null,
    previousImageTag: row.previousImageTag ?? null,
    triggeredBy: row.triggeredBy ?? null,
    startedAt: toISOString(row.startedAt),
    completedAt: toISOString(row.completedAt),
    duration: row.duration ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const deploymentRouter = {
  create: orgMemberProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        environmentId: z.string().min(1),
        resourceId: z.string().min(1),
        source: z.enum(["git_push", "manual", "rollback", "api", "preview"]),
        gitRef: z.string().optional(),
        gitCommitSha: z.string().optional(),
        buildMethod: z.enum(["nixpacks", "dockerfile", "buildpack"]).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateEnvironmentInProject(input.environmentId, input.projectId, context.organizationId);
      await validateResourceInProject(input.resourceId, input.environmentId, input.projectId, context.organizationId);

      const now = new Date();
      const row = {
        id: createId(),
        organizationId: context.organizationId,
        projectId: input.projectId,
        environmentId: input.environmentId,
        resourceId: input.resourceId,
        status: "queued" as const,
        source: input.source,
        gitRef: input.gitRef ?? null,
        gitCommitSha: input.gitCommitSha ?? null,
        gitCommitMessage: null,
        buildMethod: input.buildMethod ?? null,
        imageTag: null,
        previousImageTag: null,
        startedAt: null,
        completedAt: null,
        duration: null,
        triggeredBy: context.userId,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      };

      await db.insert(deployment).values(row);
      return formatDeployment(row as typeof deployment.$inferSelect);
    }),

  getById: orgProcedure
    .input(
      z.object({
        deploymentId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      const row = await validateDeploymentAccess(input.deploymentId, context.organizationId);
      return formatDeployment(row);
    }),

  list: orgProcedure
    .input(
      z.object({
        projectId: z.string().min(1).optional(),
        environmentId: z.string().min(1).optional(),
        resourceId: z.string().min(1).optional(),
        page: z.number().int().min(1).optional().default(1),
        pageSize: z.number().int().min(1).max(100).optional().default(10),
      }),
    )
    .handler(async ({ context, input }) => {
      const { page, pageSize } = input;
      const offset = (page - 1) * pageSize;
      const organizationId = context.organizationId;

      const conditions = [eq(deployment.organizationId, organizationId)];
      if (input.projectId) conditions.push(eq(deployment.projectId, input.projectId));
      if (input.environmentId) conditions.push(eq(deployment.environmentId, input.environmentId));
      if (input.resourceId) conditions.push(eq(deployment.resourceId, input.resourceId));

      const whereClause = and(...conditions);

      const [items, [countRow]] = await Promise.all([
        db.query.deployment.findMany({
          where: whereClause,
          orderBy: [desc(deployment.createdAt)],
          limit: pageSize,
          offset,
        }),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(deployment)
          .where(whereClause!),
      ]);

      return {
        items: items.map(formatDeployment),
        meta: paginationMeta(page, pageSize, countRow?.count ?? 0),
      };
    }),

  cancel: orgMemberProcedure
    .input(
      z.object({
        deploymentId: z.string().min(1),
        reason: z.string().max(512).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const row = await validateDeploymentAccess(input.deploymentId, context.organizationId);

      const terminalStatuses = ["live", "failed", "canceled", "rolled_back"];
      if (terminalStatuses.includes(row.status)) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Cannot cancel deployment in ${row.status} status`,
        });
      }

      await db
        .update(deployment)
        .set({ status: "canceled", updatedAt: new Date(), completedAt: new Date() })
        .where(eq(deployment.id, input.deploymentId));

      const updated = await db.query.deployment.findFirst({
        where: eq(deployment.id, input.deploymentId),
      });
      return formatDeployment(updated!);
    }),

  rollback: orgAdminProcedure
    .input(
      z.object({
        deploymentId: z.string().min(1),
        reason: z.string().max(512).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const original = await validateDeploymentAccess(input.deploymentId, context.organizationId);

      const now = new Date();
      const row = {
        id: createId(),
        organizationId: context.organizationId,
        projectId: original.projectId,
        environmentId: original.environmentId,
        resourceId: original.resourceId,
        status: "queued" as const,
        source: "rollback" as const,
        gitRef: original.gitRef,
        gitCommitSha: original.gitCommitSha,
        gitCommitMessage: null,
        buildMethod: original.buildMethod,
        imageTag: original.previousImageTag,
        previousImageTag: original.imageTag,
        startedAt: null,
        completedAt: null,
        duration: null,
        triggeredBy: context.userId,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      };

      await db.insert(deployment).values(row);
      return formatDeployment(row as typeof deployment.$inferSelect);
    }),

  streamLogs: orgProcedure
    .input(
      z.object({
        deploymentId: z.string().min(1),
        cursor: z.string().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateDeploymentAccess(input.deploymentId, context.organizationId);
      return {
        items: [] as never[],
        meta: paginationMeta(1, 10, 0),
      };
    }),
};
