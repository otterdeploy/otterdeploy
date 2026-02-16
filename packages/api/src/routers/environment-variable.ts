import * as z from "zod";
import { ORPCError } from "@orpc/server";
import { environmentVariableService, DomainError } from "@otterstack/domain";

import { orgProcedure, orgMemberProcedure, orgMemberStepUpProcedure } from "../index";
import { getIpAddress } from "../utils/http";

function mapDomainError(err: unknown): never {
  if (err instanceof DomainError) {
    throw new ORPCError(err.code, { message: err.message });
  }
  throw err;
}

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
      try {
        return await environmentVariableService.upsertEnvironmentVariable({
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
        });
      } catch (err) {
        mapDomainError(err);
      }
    }),

  get: orgProcedure
    .input(
      z.object({
        variableId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        return await environmentVariableService.getEnvironmentVariable(
          input.variableId,
          context.organizationId,
        );
      } catch (err) {
        mapDomainError(err);
      }
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
      try {
        return await environmentVariableService.listEnvironmentVariables({
          organizationId: context.organizationId,
          projectId: input.projectId,
          environmentId: input.environmentId,
          resourceId: input.resourceId,
        });
      } catch (err) {
        mapDomainError(err);
      }
    }),

  delete: orgMemberProcedure
    .input(
      z.object({
        variableId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        return await environmentVariableService.deleteEnvironmentVariable(
          input.variableId,
          context.organizationId,
          {
            userId: context.userId,
            ipAddress: getIpAddress(context.headers),
            userAgent: context.headers.get("user-agent"),
          },
        );
      } catch (err) {
        mapDomainError(err);
      }
    }),

  reveal: orgMemberStepUpProcedure
    .input(
      z.object({
        variableId: z.string().min(1),
        reason: z.string().min(1).max(256),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        return await environmentVariableService.revealEnvironmentVariable({
          variableId: input.variableId,
          organizationId: context.organizationId,
          reason: input.reason,
          audit: {
            userId: context.userId,
            ipAddress: getIpAddress(context.headers),
            userAgent: context.headers.get("user-agent"),
          },
        });
      } catch (err) {
        mapDomainError(err);
      }
    }),
};
