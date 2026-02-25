import { oc } from "@orpc/contract";
import * as z from "zod";

import {
  EnvironmentSchema,
  GraphNodeSchema,
  ProjectSchema,
  ViewportSchema,
} from "../schemas";
import { route } from "../http";
import { IdSchema, ResourceKindSchema, ResourceStatusSchema } from "../shared";

const ArchitectureGraphOutputSchema = z.object({
  project: ProjectSchema.pick({
    id: true,
    organizationId: true,
    ownerId: true,
    name: true,
    slug: true,
    createdAt: true,
    updatedAt: true,
  }),
  environment: EnvironmentSchema.pick({
    id: true,
    projectId: true,
    name: true,
    createdAt: true,
    updatedAt: true,
  }),
  viewport: ViewportSchema,
  nodes: z.array(GraphNodeSchema),
});

export const architectureContract = {
  getGraph: oc
    .route(route("GET", "/architecture/{projectId}/graph"))
    .input(
      z.object({
        projectId: IdSchema,
        environmentId: IdSchema.optional(),
      }),
    )
    .output(ArchitectureGraphOutputSchema)
    .errors({
      NOT_FOUND: { message: "Project not found" },
    }),
  replaceGraph: oc
    .route(route("PUT", "/architecture/{projectId}/graph"))
    .input(
      z.object({
        projectId: IdSchema,
        environmentId: IdSchema.optional(),
        resources: z.array(
          z.object({
            id: IdSchema,
            name: z.string(),
            kind: ResourceKindSchema,
            status: ResourceStatusSchema,
            posX: z.number(),
            posY: z.number(),
          }),
        ),
        viewport: ViewportSchema,
      }),
    )
    .output(ArchitectureGraphOutputSchema)
    .errors({
      NOT_FOUND: { message: "Project not found" },
    }),
  updateViewport: oc
    .route(route("PATCH", "/architecture/{projectId}/viewport"))
    .input(
      z.object({
        projectId: IdSchema,
        environmentId: IdSchema.optional(),
        viewport: ViewportSchema,
      }),
    )
    .output(
      z.object({
        environmentId: IdSchema,
        viewport: ViewportSchema,
      }),
    )
    .errors({
      NOT_FOUND: { message: "Project not found" },
    }),
};
