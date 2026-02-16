import * as z from "zod";
import { serverManagementService } from "@otterstack/domain";

import { orgProcedure, orgAdminStepUpProcedure } from "../index";
import { getIpAddress } from "../utils/http";
import { fromPromise } from "../utils/result";

export const serverRouter = {
  register: orgAdminStepUpProcedure
    .input(
      z.object({
        organizationId: z.string().min(1).optional(),
        name: z.string().min(1).max(128),
        ipAddress: z.string().min(1),
        port: z.number().int().min(1).max(65535).default(22),
        role: z.enum(["manager", "worker"]).default("worker"),
        ssh: z
          .object({
            name: z.string().min(1).max(128),
            publicKey: z.string().min(1),
            privateKey: z.string().min(1),
            fingerprint: z.string().min(1),
          })
          .optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      return fromPromise(
        serverManagementService.registerServer({
          organizationId: context.organizationId,
          name: input.name,
          ipAddress: input.ipAddress,
          port: input.port,
          role: input.role,
          ssh: input.ssh,
          audit: {
            userId: context.userId,
            ipAddress: getIpAddress(context.headers),
            userAgent: context.headers.get("user-agent"),
          },
        }),
      );
    }),

  list: orgProcedure
    .input(
      z.object({
        organizationId: z.string().min(1).optional(),
      }),
    )
    .handler(async ({ context }) => {
      return fromPromise(serverManagementService.listServers(context.organizationId));
    }),

  test: orgProcedure
    .input(
      z.object({
        serverId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      return fromPromise(
        serverManagementService.testServer(input.serverId, context.organizationId),
      );
    }),

  remove: orgAdminStepUpProcedure
    .input(
      z.object({
        serverId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      return fromPromise(
        serverManagementService.removeServer(input.serverId, context.organizationId, {
          userId: context.userId,
          ipAddress: getIpAddress(context.headers),
          userAgent: context.headers.get("user-agent"),
        }),
      );
    }),
};
