import * as z from "zod";
import { monitoringService } from "@otterstack/domain";

import { orgProcedure } from "../index";

export const monitoringRouter = {
  getMetrics: orgProcedure
    .input(
      z.object({
        resourceId: z.string().min(1),
        metric: z.enum(["cpu", "memory", "network_in", "network_out", "disk"]),
        from: z.iso.datetime(),
        to: z.iso.datetime(),
      }),
    )
    .handler(async ({ context, input }) => {
      return monitoringService.getMetrics({
        resourceId: input.resourceId,
        organizationId: context.organizationId,
        metric: input.metric,
        from: input.from,
        to: input.to,
      });
    }),

  getLogs: orgProcedure
    .input(
      z.object({
        resourceId: z.string().min(1),
        from: z.iso.datetime().optional(),
        to: z.iso.datetime().optional(),
        page: z.number().int().min(1).optional().default(1),
        pageSize: z.number().int().min(1).max(100).optional().default(10),
      }),
    )
    .handler(async ({ context, input }) => {
      return monitoringService.getLogs({
        resourceId: input.resourceId,
        organizationId: context.organizationId,
        from: input.from,
        to: input.to,
        page: input.page,
        pageSize: input.pageSize,
      });
    }),

  streamLogs: orgProcedure
    .input(
      z.object({
        resourceId: z.string().min(1),
        cursor: z.string().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      return monitoringService.streamLogs({
        resourceId: input.resourceId,
        organizationId: context.organizationId,
        cursor: input.cursor,
      });
    }),
};
