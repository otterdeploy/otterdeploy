import { oc } from "@orpc/contract";
import * as z from "zod/v4";

import { ProjectSchema } from "../schemas";
import { route } from "../http";
import {
  IdSchema,
  PaginatedInputSchema,
  SlugSchema,
  SuccessSchema,
  createPaginatedOutputSchema,
} from "../shared";

export const projectContract = {
  create: oc
    .route(route("POST", "/projects"))
    .input(
      z.object({
        organizationId: IdSchema,
        name: z.string().min(1).max(128),
        slug: SlugSchema.optional(),
      }),
    )
    .output(ProjectSchema)
    .errors({
      CONFLICT: { message: "Slug already in use or failed to create project" },
    }),
  getById: oc
    .route(route("GET", "/projects/{projectId}"))
    .input(
      z.object({
        projectId: IdSchema,
      }),
    )
    .output(ProjectSchema)
    .errors({
      NOT_FOUND: { message: "Project not found" },
    }),
  list: oc
    .route(route("GET", "/projects"))
    .input(
      PaginatedInputSchema.extend({
        organizationId: IdSchema,
      }),
    )
    .output(createPaginatedOutputSchema(ProjectSchema)),
  update: oc
    .route(route("PATCH", "/projects/{projectId}"))
    .input(
      z.object({
        projectId: IdSchema,
        name: z.string().min(1).max(128).optional(),
        slug: SlugSchema.optional(),
      }),
    )
    .output(ProjectSchema)
    .errors({
      NOT_FOUND: { message: "Project not found" },
      CONFLICT: { message: "Slug already in use" },
    }),
  delete: oc
    .route(route("DELETE", "/projects/{projectId}"))
    .input(
      z.object({
        projectId: IdSchema,
      }),
    )
    .output(SuccessSchema)
    .errors({
      NOT_FOUND: { message: "Project not found" },
    }),
};
