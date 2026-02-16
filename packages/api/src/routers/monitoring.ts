import * as z from "zod";

import { orgProcedure } from "../index";
import { paginationMeta } from "../utils/helpers";
import { validateResourceAccess } from "../utils/ownership";

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
      await validateResourceAccess(input.resourceId, context.organizationId);
      return {
        resourceId: input.resourceId,
        metric: input.metric,
        points: [] as never[],
      };
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
      await validateResourceAccess(input.resourceId, context.organizationId);
      return {
        items: [] as never[],
        meta: paginationMeta(input.page, input.pageSize, 0),
      };
    }),

  streamLogs: orgProcedure
    .input(
      z.object({
        resourceId: z.string().min(1),
        cursor: z.string().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateResourceAccess(input.resourceId, context.organizationId);
      return {
        items: [] as never[],
        meta: paginationMeta(1, 10, 0),
      };
    }),
};
