import { oc } from "@orpc/contract";
import * as z from "zod";

import { EnvironmentVariableRevealSchema, EnvironmentVariableSchema } from "../schemas";
import { route } from "../http";
import { EnvVarScopeSchema, IdSchema, SuccessSchema } from "../shared";

export const environmentVariableContract = {
  upsert: oc
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
    .output(EnvironmentVariableSchema)
    .errors({
      NOT_FOUND: { message: "Project, environment, or resource not found" },
      BAD_REQUEST: { message: "Invalid scope configuration" },
      CONFLICT: { message: "Failed to create environment variable" },
    }),
  get: oc
    .route(route("GET", "/environment-variables/{variableId}"))
    .input(
      z.object({
        variableId: IdSchema,
      }),
    )
    .output(EnvironmentVariableSchema)
    .errors({
      NOT_FOUND: { message: "Environment variable not found" },
    }),
  list: oc
    .route(route("GET", "/environment-variables"))
    .input(
      z.object({
        projectId: IdSchema,
        environmentId: IdSchema.optional(),
        resourceId: IdSchema.optional(),
      }),
    )
    .output(z.array(EnvironmentVariableSchema))
    .errors({
      NOT_FOUND: { message: "Project not found" },
    }),
  delete: oc
    .route(route("DELETE", "/environment-variables/{variableId}"))
    .input(
      z.object({
        variableId: IdSchema,
      }),
    )
    .output(SuccessSchema)
    .errors({
      NOT_FOUND: { message: "Environment variable not found" },
    }),
  reveal: oc
    .route(route("POST", "/environment-variables/{variableId}/reveal"))
    .input(
      z.object({
        variableId: IdSchema,
        reason: z.string().min(1).max(256),
      }),
    )
    .output(EnvironmentVariableRevealSchema)
    .errors({
      NOT_FOUND: { message: "Environment variable not found" },
      BAD_REQUEST: { message: "Variable has no secret reference" },
    }),
};
