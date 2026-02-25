import * as z from "zod";
import { deploymentService, deploymentSecretService } from "@otterdeploy/domain";

import { orgProcedure, orgMemberProcedure, orgAdminProcedure } from "../index";
import { paginationMeta } from "../utils/helpers";
import { unwrapResult } from "../utils/result";

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
        builder: z.enum(["nixpacks", "dockerfile", "buildpack"]).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const result = unwrapResult(
        await deploymentService.createDeployment({
          organizationId: context.organizationId,
          projectId: input.projectId,
          environmentId: input.environmentId,
          resourceId: input.resourceId,
          source: input.source,
          triggeredBy: context.userId,
          gitRef: input.gitRef,
          gitCommitSha: input.gitCommitSha,
          builder: input.builder,
          correlationId: context.correlationId ?? undefined,
        }),
      );

      await deploymentSecretService.createDeploymentSecretSnapshot({
        deploymentId: result.id,
        organizationId: context.organizationId,
        projectId: input.projectId,
        environmentId: input.environmentId,
        resourceId: input.resourceId,
      });

      return result;
    }),

  getById: orgProcedure
    .input(
      z.object({
        deploymentId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      const result = unwrapResult(
        await deploymentService.getDeploymentWithTimeline(input.deploymentId, context.organizationId),
      );
      return result.deployment;
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
      return unwrapResult(
        await deploymentService.cancelDeployment(
          input.deploymentId,
          context.organizationId,
          context.userId,
        ),
      );
    }),

  rollback: orgAdminProcedure
    .input(
      z.object({
        deploymentId: z.string().min(1),
        reason: z.string().max(512).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      return unwrapResult(
        await deploymentService.initiateRollback(
          input.deploymentId,
          context.organizationId,
          context.userId,
          input.reason,
          context.correlationId ?? undefined,
        ),
      );
    }),

  streamLogs: orgProcedure
    .input(
      z.object({
        deploymentId: z.string().min(1),
        cursor: z.string().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      unwrapResult(
        await deploymentService.getDeploymentWithTimeline(input.deploymentId, context.organizationId),
      );
      return {
        items: [],
        meta: paginationMeta(1, 10, 0),
      };
    }),
};
