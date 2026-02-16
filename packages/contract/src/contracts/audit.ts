import { oc } from "@orpc/contract";
import * as z from "zod";

import { AuditLogSchema } from "../schemas";
import { route } from "../http";
import { IdSchema, PaginatedInputSchema, createPaginatedOutputSchema } from "../shared";

export const auditContract = {
  list: oc
    .route(route("GET", "/audit"))
    .input(
      PaginatedInputSchema.extend({
        organizationId: IdSchema,
        action: z.string().optional(),
        actorUserId: IdSchema.optional(),
      }),
    )
    .output(createPaginatedOutputSchema(AuditLogSchema)),
};
