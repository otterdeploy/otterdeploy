import { oc } from "@orpc/contract";
import * as z from "zod";

import { DeploymentLogSchema, DeploymentSchema } from "../schemas";
import { route } from "../http";
import {
  BuildMethodSchema,
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
        buildMethod: BuildMethodSchema.optional(),
      }),
    )
    .output(DeploymentSchema),
  getById: oc
    .route(route("GET", "/deployments/{deploymentId}"))
    .input(
      z.object({
        deploymentId: IdSchema,
      }),
    )
    .output(DeploymentSchema),
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
    .output(DeploymentSchema),
  rollback: oc
    .route(route("POST", "/deployments/{deploymentId}/rollback"))
    .input(
      z.object({
        deploymentId: IdSchema,
        reason: z.string().max(512).optional(),
      }),
    )
    .output(DeploymentSchema),
  streamLogs: oc
    .route(route("GET", "/deployments/{deploymentId}/logs"))
    .input(
      z.object({
        deploymentId: IdSchema,
        cursor: z.string().optional(),
      }),
    )
    .output(createPaginatedOutputSchema(DeploymentLogSchema)),
};
