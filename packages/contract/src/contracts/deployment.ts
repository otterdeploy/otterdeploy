import { oc } from "@orpc/contract";
import * as z from "zod";

import { DeploymentLogSchema, DeploymentSchema } from "../schemas";
import { route } from "../http";
import {
  BuilderSchema,
  DeploymentSourceSchema,
  IdSchema,
  PaginatedInputSchema,
  createPaginatedOutputSchema,
} from "../shared";

export const deploymentContract = {
  create: oc
    .route(route("POST", "/deployments"))
    .input(
      z.object({
        projectId: IdSchema,
        environmentId: IdSchema,
        resourceId: IdSchema,
        source: DeploymentSourceSchema,
        gitRef: z.string().optional(),
        gitCommitSha: z.string().optional(),
        builder: BuilderSchema.optional(),
      }),
    )
    .output(DeploymentSchema)
    .errors({
      NOT_FOUND: { message: "Resource not found" },
      CONFLICT: { message: "Failed to create deployment" },
    }),
  getById: oc
    .route(route("GET", "/deployments/{deploymentId}"))
    .input(
      z.object({
        deploymentId: IdSchema,
      }),
    )
    .output(DeploymentSchema)
    .errors({
      NOT_FOUND: { message: "Deployment not found" },
    }),
  list: oc
    .route(route("GET", "/deployments"))
    .input(
      PaginatedInputSchema.extend({
        projectId: IdSchema.optional(),
        environmentId: IdSchema.optional(),
        resourceId: IdSchema.optional(),
      }),
    )
    .output(createPaginatedOutputSchema(DeploymentSchema)),
  cancel: oc
    .route(route("POST", "/deployments/{deploymentId}/cancel"))
    .input(
      z.object({
        deploymentId: IdSchema,
        reason: z.string().max(512).optional(),
      }),
    )
    .output(DeploymentSchema)
    .errors({
      NOT_FOUND: { message: "Deployment not found" },
      CONFLICT: { message: "Deployment cannot be canceled in current state" },
    }),
  rollback: oc
    .route(route("POST", "/deployments/{deploymentId}/rollback"))
    .input(
      z.object({
        deploymentId: IdSchema,
        reason: z.string().max(512).optional(),
      }),
    )
    .output(DeploymentSchema)
    .errors({
      NOT_FOUND: { message: "Deployment not found" },
      CONFLICT: { message: "Deployment is not in a rollbackable state" },
    }),
  streamLogs: oc
    .route(route("GET", "/deployments/{deploymentId}/logs"))
    .input(
      z.object({
        deploymentId: IdSchema,
        cursor: z.string().optional(),
      }),
    )
    .output(createPaginatedOutputSchema(DeploymentLogSchema))
    .errors({
      NOT_FOUND: { message: "Deployment not found" },
    }),
};
