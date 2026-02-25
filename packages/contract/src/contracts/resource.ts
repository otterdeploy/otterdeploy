import { oc } from "@orpc/contract";
import * as z from "zod";

import { ResourceSchema } from "../schemas";
import { route } from "../http";
import {
  IdSchema,
  ResourceKindSchema,
  ResourceStatusSchema,
  SuccessSchema,
} from "../shared";

export const resourceContract = {
  create: oc
    .route(route("POST", "/resources"))
    .input(
      z.object({
        projectId: IdSchema,
        environmentId: IdSchema,
        name: z.string().min(1).max(128),
        kind: ResourceKindSchema,
      }),
    )
    .output(ResourceSchema)
    .errors({
      NOT_FOUND: { message: "Environment not found" },
      CONFLICT: { message: "Failed to create resource" },
    }),
  getById: oc
    .route(route("GET", "/resources/{resourceId}"))
    .input(
      z.object({
        resourceId: IdSchema,
      }),
    )
    .output(ResourceSchema)
    .errors({
      NOT_FOUND: { message: "Resource not found" },
    }),
  list: oc
    .route(route("GET", "/projects/{projectId}/resources"))
    .input(
      z.object({
        projectId: IdSchema,
        environmentId: IdSchema.optional(),
      }),
    )
    .output(z.array(ResourceSchema))
    .errors({
      NOT_FOUND: { message: "Project not found" },
    }),
  update: oc
    .route(route("PATCH", "/resources/{resourceId}"))
    .input(
      z.object({
        resourceId: IdSchema,
        name: z.string().min(1).max(128).optional(),
        status: ResourceStatusSchema.optional(),
      }),
    )
    .output(ResourceSchema)
    .errors({
      NOT_FOUND: { message: "Resource not found" },
    }),
  delete: oc
    .route(route("DELETE", "/resources/{resourceId}"))
    .input(
      z.object({
        resourceId: IdSchema,
      }),
    )
    .output(SuccessSchema)
    .errors({
      NOT_FOUND: { message: "Resource not found" },
    }),
};
