import { oc } from "@orpc/contract";
import * as z from "zod";

import { BackupSchema } from "../schemas";
import { route } from "../http";
import { IdSchema, PaginatedInputSchema, SuccessSchema, createPaginatedOutputSchema } from "../shared";

export const backupContract = {
  create: oc
    .route(route("POST", "/backups"))
    .input(
      z.object({
        resourceId: IdSchema,
      }),
    )
    .output(BackupSchema),
  list: oc
    .route(route("GET", "/backups"))
    .input(
      PaginatedInputSchema.extend({
        organizationId: IdSchema,
        resourceId: IdSchema.optional(),
      }),
    )
    .output(createPaginatedOutputSchema(BackupSchema)),
  restore: oc
    .route(route("POST", "/backups/{backupId}/restore"))
    .input(
      z.object({
        backupId: IdSchema,
        targetResourceId: IdSchema,
      }),
    )
    .output(SuccessSchema),
  delete: oc
    .route(route("DELETE", "/backups/{backupId}"))
    .input(
      z.object({
        backupId: IdSchema,
      }),
    )
    .output(SuccessSchema),
};
