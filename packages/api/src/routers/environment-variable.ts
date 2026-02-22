import * as z from "zod";
import { environmentVariableService } from "@otterdeploy/domain";

import { orgProcedure, orgMemberProcedure, orgMemberStepUpProcedure } from "../index";
import { getIpAddress } from "../utils/http";
import { unwrapResult } from "../utils/result";

export const environmentVariableRouter = {
  upsert: orgMemberProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        environmentId: z.string().min(1).optional(),
        resourceId: z.string().min(1).optional(),
        scope: z.enum(["project", "environment", "resource"]),
        key: z.string().min(1),
        value: z.string().min(1),
        isSecret: z.boolean().default(true),
        buildTime: z.boolean().default(false),
      }),
    )
    .handler(async ({ context, input }) => {
      return unwrapResult(
        await environmentVariableService.upsertEnvironmentVariable({
          organizationId: context.organizationId,
          projectId: input.projectId,
          environmentId: input.environmentId,
          resourceId: input.resourceId,
          scope: input.scope,
          key: input.key,
          value: input.value,
          isSecret: input.isSecret,
          buildTime: input.buildTime,
          audit: {
            userId: context.userId,
            ipAddress: getIpAddress(context.headers),
            userAgent: context.headers.get("user-agent"),
          },
        }),
      );
    }),

  get: orgProcedure
    .input(
      z.object({
        variableId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      return unwrapResult(
        await environmentVariableService.getEnvironmentVariable(input.variableId, context.organizationId),
      );
    }),

  list: orgProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        environmentId: z.string().min(1).optional(),
        resourceId: z.string().min(1).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      return unwrapResult(
        await environmentVariableService.listEnvironmentVariables({
          organizationId: context.organizationId,
          projectId: input.projectId,
          environmentId: input.environmentId,
          resourceId: input.resourceId,
        }),
      );
    }),

  delete: orgMemberProcedure
    .input(
      z.object({
        variableId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      return unwrapResult(
        await environmentVariableService.deleteEnvironmentVariable(
          input.variableId,
          context.organizationId,
          {
            userId: context.userId,
            ipAddress: getIpAddress(context.headers),
            userAgent: context.headers.get("user-agent"),
          },
        ),
      );
    }),

  reveal: orgMemberStepUpProcedure
    .input(
      z.object({
        variableId: z.string().min(1),
        reason: z.string().min(1).max(256),
      }),
    )
    .handler(async ({ context, input }) => {
      return unwrapResult(
        await environmentVariableService.revealEnvironmentVariable({
          variableId: input.variableId,
          organizationId: context.organizationId,
          reason: input.reason,
          audit: {
            userId: context.userId,
            ipAddress: getIpAddress(context.headers),
            userAgent: context.headers.get("user-agent"),
          },
        }),
      );
    }),
};
