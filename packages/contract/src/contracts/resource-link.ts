import { oc } from "@orpc/contract";
import * as z from "zod";

import { ResourceLinkSchema } from "../schemas";
import { route } from "../http";
import { IdSchema, ResourceLinkTypeSchema, SuccessSchema } from "../shared";

export const resourceLinkContract = {
  create: oc
    .route(route("POST", "/resource-links"))
    .input(
      z.object({
        projectId: IdSchema,
        environmentId: IdSchema,
        sourceResourceId: IdSchema,
        targetResourceId: IdSchema,
        linkType: ResourceLinkTypeSchema.optional(),
      }),
    )
    .output(ResourceLinkSchema)
    .errors({
      NOT_FOUND: { message: "Resource not found" },
      BAD_REQUEST: { message: "Cannot link a resource to itself" },
      CONFLICT: { message: "Link already exists" },
    }),
  delete: oc
    .route(route("DELETE", "/resource-links/{linkId}"))
    .input(
      z.object({
        linkId: IdSchema,
      }),
    )
    .output(SuccessSchema)
    .errors({
      NOT_FOUND: { message: "Resource link not found" },
    }),
};
