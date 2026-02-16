import * as z from "zod";
import { backupService } from "@otterstack/domain";

import { orgProcedure, orgAdminProcedure } from "../index";
import { fromPromise } from "../utils/result";

export const backupRouter = {
  create: orgAdminProcedure
    .input(
      z.object({
        resourceId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      return fromPromise(
        backupService.createBackup({
          organizationId: context.organizationId,
          resourceId: input.resourceId,
        }),
      );
    }),

  list: orgProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        resourceId: z.string().min(1).optional(),
        page: z.number().int().min(1).optional().default(1),
        pageSize: z.number().int().min(1).max(100).optional().default(10),
      }),
    )
    .handler(async ({ context, input }) => {
      return fromPromise(
        backupService.listBackups({
          organizationId: context.organizationId,
          resourceId: input.resourceId,
          page: input.page,
          pageSize: input.pageSize,
        }),
      );
    }),

  restore: orgAdminProcedure
    .input(
      z.object({
        backupId: z.string().min(1),
        targetResourceId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      return fromPromise(
        backupService.restoreBackup(input.backupId, input.targetResourceId, context.organizationId),
      );
    }),

  delete: orgAdminProcedure
    .input(
      z.object({
        backupId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      return fromPromise(backupService.deleteBackup(input.backupId, context.organizationId));
    }),
};
