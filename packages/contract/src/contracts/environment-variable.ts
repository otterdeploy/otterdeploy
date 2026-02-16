import { oc } from "@orpc/contract";
import * as z from "zod";

import { EnvironmentVariableSchema } from "../schemas";
import { route } from "../http";
import { EnvVarScopeSchema, IdSchema, SuccessSchema } from "../shared";

export const environmentVariableContract = {
  set: oc
    .route(route("PUT", "/environment-variables"))
    .input(
      z.object({
        projectId: IdSchema,
        environmentId: IdSchema.optional(),
        resourceId: IdSchema.optional(),
        scope: EnvVarScopeSchema,
        key: z.string().min(1),
        value: z.string().min(1),
        isSecret: z.boolean().default(true),
        buildTime: z.boolean().default(false),
      }),
    )
    .output(EnvironmentVariableSchema),
  get: oc
    .route(route("GET", "/environment-variables/{variableId}"))
    .input(
      z.object({
        variableId: IdSchema,
      }),
    )
    .output(EnvironmentVariableSchema),
  list: oc
    .route(route("GET", "/environment-variables"))
    .input(
      z.object({
        projectId: IdSchema,
        environmentId: IdSchema.optional(),
        resourceId: IdSchema.optional(),
      }),
    )
    .output(z.array(EnvironmentVariableSchema)),
  delete: oc
    .route(route("DELETE", "/environment-variables/{variableId}"))
    .input(
      z.object({
        variableId: IdSchema,
      }),
    )
    .output(SuccessSchema),
};
