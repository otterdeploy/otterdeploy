import * as z from "zod";
import { auditService } from "@otterdeploy/domain";

import { orgAdminProcedure } from "../index";

export const auditRouter = {
  list: orgAdminProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        action: z.string().optional(),
        actorUserId: z.string().min(1).optional(),
        page: z.number().int().min(1).optional().default(1),
        pageSize: z.number().int().min(1).max(100).optional().default(10),
      }),
    )
    .handler(async ({ context, input }) => {
      return auditService.listAuditLogs({
        organizationId: context.organizationId,
        action: input.action,
        actorUserId: input.actorUserId,
        page: input.page,
        pageSize: input.pageSize,
      });
    }),
};
