import { oc } from "@orpc/contract";
import * as z from "zod";

import { DomainSchema } from "../schemas";
import { route } from "../http";
import { IdSchema, SuccessSchema } from "../shared";

export const domainContract = {
  add: oc
    .route(route("POST", "/domains"))
    .input(
      z.object({
        resourceId: IdSchema,
        domain: z.string().min(3),
      }),
    )
    .output(DomainSchema),
  verify: oc
    .route(route("POST", "/domains/{domainId}/verify"))
    .input(
      z.object({
        domainId: IdSchema,
      }),
    )
    .output(DomainSchema),
  list: oc
    .route(route("GET", "/domains"))
    .input(
      z.object({
        resourceId: IdSchema.optional(),
        organizationId: IdSchema.optional(),
      }),
    )
    .output(z.array(DomainSchema)),
  remove: oc
    .route(route("DELETE", "/domains/{domainId}"))
    .input(
      z.object({
        domainId: IdSchema,
      }),
    )
    .output(SuccessSchema),
};
