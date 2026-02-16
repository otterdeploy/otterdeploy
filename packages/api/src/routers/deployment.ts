import * as z from "zod";
import { ORPCError } from "@orpc/server";
import { deploymentService, deploymentSecretService, DomainError } from "@otterstack/domain";

import {
  orgProcedure,
  orgMemberProcedure,
  orgAdminProcedure,
} from "../index";
import { paginationMeta } from "../utils/helpers";

function mapDomainError(err: unknown): never {
  if (err instanceof DomainError) {
    throw new ORPCError(err.code, { message: err.message });
  }
  throw err;
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
      try {
        const result = await deploymentService.createDeployment({
          organizationId: context.organizationId,
          projectId: input.projectId,
          environmentId: input.environmentId,
          resourceId: input.resourceId,
          source: input.source,
          triggeredBy: context.userId,
          gitRef: input.gitRef,
          gitCommitSha: input.gitCommitSha,
          buildMethod: input.buildMethod,
          correlationId: context.correlationId ?? undefined,
        });

        await deploymentSecretService.createDeploymentSecretSnapshot({
          deploymentId: result.id,
          organizationId: context.organizationId,
          projectId: input.projectId,
          environmentId: input.environmentId,
          resourceId: input.resourceId,
        });

        return result;
      } catch (err) {
        mapDomainError(err);
      }
    }),

  getById: orgProcedure
    .input(
      z.object({
        deploymentId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        const result = await deploymentService.getDeploymentWithTimeline(
          input.deploymentId,
          context.organizationId,
        );
        return result.deployment;
      } catch (err) {
        mapDomainError(err);
      }
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
      return deploymentService.listDeployments({
        organizationId: context.organizationId,
        projectId: input.projectId,
        environmentId: input.environmentId,
        resourceId: input.resourceId,
        page: input.page,
        pageSize: input.pageSize,
      });
    }),

  cancel: orgMemberProcedure
    .input(
      z.object({
        deploymentId: z.string().min(1),
        reason: z.string().max(512).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        return await deploymentService.cancelDeployment(
          input.deploymentId,
          context.organizationId,
          context.userId,
        );
      } catch (err) {
        mapDomainError(err);
      }
    }),

  rollback: orgAdminProcedure
    .input(
      z.object({
        deploymentId: z.string().min(1),
        reason: z.string().max(512).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        return await deploymentService.initiateRollback(
          input.deploymentId,
          context.organizationId,
          context.userId,
          input.reason,
          context.correlationId ?? undefined,
        );
      } catch (err) {
        mapDomainError(err);
      }
    }),

  streamLogs: orgProcedure
    .input(
      z.object({
        deploymentId: z.string().min(1),
        cursor: z.string().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        await deploymentService.getDeploymentWithTimeline(input.deploymentId, context.organizationId);
      } catch (err) {
        mapDomainError(err);
      }
      return {
        items: [] as never[],
        meta: paginationMeta(1, 10, 0),
      };
    }),
};
