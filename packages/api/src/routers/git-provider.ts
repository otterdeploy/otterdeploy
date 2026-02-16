import * as z from "zod";
import { gitProviderService } from "@otterstack/domain";

import { orgAdminProcedure, orgAdminStepUpProcedure } from "../index";
import { getIpAddress } from "../utils/http";
import { unwrapResult } from "../utils/result";

export const gitProviderRouter = {
  create: orgAdminStepUpProcedure
    .input(
      z.object({
        organizationId: z.string().min(1).optional(),
        type: z.string().min(1),
        name: z.string().min(1).max(128),
        appId: z.string().optional(),
        clientId: z.string().optional(),
        clientSecret: z.string().optional(),
        installationId: z.string().optional(),
        webhookSecret: z.string().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      return unwrapResult(
        await gitProviderService.createGitProvider({
          organizationId: context.organizationId,
          type: input.type,
          name: input.name,
          appId: input.appId,
          clientId: input.clientId,
          clientSecret: input.clientSecret,
          installationId: input.installationId,
          webhookSecret: input.webhookSecret,
          audit: {
            userId: context.userId,
            ipAddress: getIpAddress(context.headers),
            userAgent: context.headers.get("user-agent"),
          },
        }),
      );
    }),

  update: orgAdminStepUpProcedure
    .input(
      z.object({
        providerId: z.string().min(1),
        type: z.string().min(1).optional(),
        name: z.string().min(1).max(128).optional(),
        appId: z.string().nullable().optional(),
        clientId: z.string().nullable().optional(),
        clientSecret: z.string().optional(),
        installationId: z.string().nullable().optional(),
        webhookSecret: z.string().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      return unwrapResult(
        await gitProviderService.updateGitProvider({
          organizationId: context.organizationId,
          providerId: input.providerId,
          type: input.type,
          name: input.name,
          appId: input.appId,
          clientId: input.clientId,
          clientSecret: input.clientSecret,
          installationId: input.installationId,
          webhookSecret: input.webhookSecret,
          audit: {
            userId: context.userId,
            ipAddress: getIpAddress(context.headers),
            userAgent: context.headers.get("user-agent"),
          },
        }),
      );
    }),

  list: orgAdminProcedure
    .input(
      z.object({
        organizationId: z.string().min(1).optional(),
      }),
    )
    .handler(async ({ context }) => {
      return gitProviderService.listGitProviders(context.organizationId);
    }),

  delete: orgAdminProcedure
    .input(
      z.object({
        providerId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      return unwrapResult(
        await gitProviderService.deleteGitProvider(input.providerId, context.organizationId, {
          userId: context.userId,
          ipAddress: getIpAddress(context.headers),
          userAgent: context.headers.get("user-agent"),
        }),
      );
    }),

  rotateSecret: orgAdminStepUpProcedure
    .input(
      z.object({
        providerId: z.string().min(1),
        reason: z.string().min(1).max(256),
        clientSecret: z.string().optional(),
        webhookSecret: z.string().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      return unwrapResult(
        await gitProviderService.rotateGitProviderSecret({
          organizationId: context.organizationId,
          providerId: input.providerId,
          reason: input.reason,
          clientSecret: input.clientSecret,
          webhookSecret: input.webhookSecret,
          audit: {
            userId: context.userId,
            ipAddress: getIpAddress(context.headers),
            userAgent: context.headers.get("user-agent"),
          },
        }),
      );
    }),
};
