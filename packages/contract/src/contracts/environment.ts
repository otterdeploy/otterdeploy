import { oc } from "@orpc/contract";
import * as z from "zod";

import { EnvironmentSchema } from "../schemas";
import { route } from "../http";
import { IdSchema, SuccessSchema } from "../shared";

export const environmentContract = {
  create: oc
    .route(route("POST", "/environments"))
    .input(
      z.object({
        projectId: IdSchema,
        name: z.string().min(1).max(64),
      }),
    )
    .output(EnvironmentSchema)
    .errors({
      NOT_FOUND: { message: "Project not found" },
    }),
  getById: oc
    .route(route("GET", "/environments/{environmentId}"))
    .input(
      z.object({
        environmentId: IdSchema,
      }),
    )
    .output(EnvironmentSchema)
    .errors({
      NOT_FOUND: { message: "Environment not found" },
    }),
  list: oc
    .route(route("GET", "/projects/{projectId}/environments"))
    .input(
      z.object({
        projectId: IdSchema,
      }),
    )
    .output(z.array(EnvironmentSchema))
    .errors({
      NOT_FOUND: { message: "Project not found" },
    }),
  delete: oc
    .route(route("DELETE", "/environments/{environmentId}"))
    .input(
      z.object({
        environmentId: IdSchema,
      }),
    )
    .output(SuccessSchema)
    .errors({
      NOT_FOUND: { message: "Environment not found" },
    }),
};
