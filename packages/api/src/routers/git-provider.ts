import * as z from "zod";
import { ORPCError } from "@orpc/server";
import { gitProviderService, DomainError } from "@otterstack/domain";

import { orgAdminProcedure, orgAdminStepUpProcedure } from "../index";
import { getIpAddress } from "../utils/http";

function mapDomainError(err: unknown): never {
  if (err instanceof DomainError) {
    throw new ORPCError(err.code, { message: err.message });
  }
  throw err;
}

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
      try {
        return await gitProviderService.createGitProvider({
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
        });
      } catch (err) {
        mapDomainError(err);
      }
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
      try {
        return await gitProviderService.updateGitProvider({
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
        });
      } catch (err) {
        mapDomainError(err);
      }
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
      try {
        return await gitProviderService.deleteGitProvider(
          input.providerId,
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
      try {
        return await gitProviderService.rotateGitProviderSecret({
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
        });
      } catch (err) {
        mapDomainError(err);
      }
    }),
};
