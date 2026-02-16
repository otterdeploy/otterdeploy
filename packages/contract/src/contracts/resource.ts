import { oc } from "@orpc/contract";
import * as z from "zod";

import { ResourceSchema } from "../schemas";
import { route } from "../http";
import {
  BuildMethodSchema,
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
        status: ResourceStatusSchema.optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        posX: z.number(),
        posY: z.number(),
        buildMethod: BuildMethodSchema.optional(),
        dockerfilePath: z.string().optional(),
        port: z.number().int().optional(),
        healthCheckPath: z.string().optional(),
        replicas: z.number().int().min(1).optional(),
      }),
    )
    .output(ResourceSchema),
  getById: oc
    .route(route("GET", "/resources/{resourceId}"))
    .input(
      z.object({
        resourceId: IdSchema,
      }),
    )
    .output(ResourceSchema),
  list: oc
    .route(route("GET", "/projects/{projectId}/resources"))
    .input(
      z.object({
        projectId: IdSchema,
        environmentId: IdSchema.optional(),
      }),
    )
    .output(z.array(ResourceSchema)),
  update: oc
    .route(route("PATCH", "/resources/{resourceId}"))
    .input(
      z.object({
        resourceId: IdSchema,
        name: z.string().min(1).max(128).optional(),
        kind: ResourceKindSchema.optional(),
        status: ResourceStatusSchema.optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        posX: z.number().optional(),
        posY: z.number().optional(),
        buildMethod: BuildMethodSchema.nullable().optional(),
        dockerfilePath: z.string().nullable().optional(),
        port: z.number().int().nullable().optional(),
        healthCheckPath: z.string().nullable().optional(),
        replicas: z.number().int().min(1).nullable().optional(),
      }),
    )
    .output(ResourceSchema),
  delete: oc
    .route(route("DELETE", "/resources/{resourceId}"))
    .input(
      z.object({
        resourceId: IdSchema,
      }),
    )
    .output(SuccessSchema),
};
