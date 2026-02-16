import * as z from "zod";
import { ORPCError } from "@orpc/server";
import { backupService, DomainError } from "@otterstack/domain";

import { orgProcedure, orgAdminProcedure } from "../index";

function mapDomainError(err: unknown): never {
  if (err instanceof DomainError) {
    throw new ORPCError(err.code, { message: err.message });
  }
  throw err;
}

export const backupRouter = {
  create: orgAdminProcedure
    .input(
      z.object({
        resourceId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        return await backupService.createBackup({
          organizationId: context.organizationId,
          resourceId: input.resourceId,
        });
      } catch (err) {
        mapDomainError(err);
      }
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
      return backupService.listBackups({
        organizationId: context.organizationId,
        resourceId: input.resourceId,
        page: input.page,
        pageSize: input.pageSize,
      });
    }),

  restore: orgAdminProcedure
    .input(
      z.object({
        backupId: z.string().min(1),
        targetResourceId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        return await backupService.restoreBackup(
          input.backupId,
          input.targetResourceId,
          context.organizationId,
        );
      } catch (err) {
        mapDomainError(err);
      }
    }),

  delete: orgAdminProcedure
    .input(
      z.object({
        backupId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        return await backupService.deleteBackup(
          input.backupId,
          context.organizationId,
        );
      } catch (err) {
        mapDomainError(err);
      }
    }),
};
