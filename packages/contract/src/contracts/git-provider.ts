import { oc } from "@orpc/contract";
import * as z from "zod";

import { GitProviderSchema } from "../schemas";
import { route } from "../http";
import { IdSchema, SuccessSchema } from "../shared";

export const gitProviderContract = {
  create: oc
    .route(route("POST", "/git-providers"))
    .input(
      z.object({
        organizationId: IdSchema.optional(),
        type: z.string().min(1),
        name: z.string().min(1).max(128),
        appId: z.string().optional(),
        clientId: z.string().optional(),
        clientSecret: z.string().optional(),
        installationId: z.string().optional(),
        webhookSecret: z.string().optional(),
      }),
    )
    .output(GitProviderSchema)
    .errors({
      CONFLICT: { message: "Failed to create git provider" },
    }),
  update: oc
    .route(route("PATCH", "/git-providers/{providerId}"))
    .input(
      z.object({
        providerId: IdSchema,
        type: z.string().min(1).optional(),
        name: z.string().min(1).max(128).optional(),
        appId: z.string().nullable().optional(),
        clientId: z.string().nullable().optional(),
        clientSecret: z.string().optional(),
        installationId: z.string().nullable().optional(),
        webhookSecret: z.string().optional(),
      }),
    )
    .output(GitProviderSchema)
    .errors({
      NOT_FOUND: { message: "Git provider not found" },
    }),
  list: oc
    .route(route("GET", "/git-providers"))
    .input(
      z.object({
        organizationId: IdSchema.optional(),
      }),
    )
    .output(z.array(GitProviderSchema)),
  delete: oc
    .route(route("DELETE", "/git-providers/{providerId}"))
    .input(
      z.object({
        providerId: IdSchema,
      }),
    )
    .output(SuccessSchema)
    .errors({
      NOT_FOUND: { message: "Git provider not found" },
    }),
  rotateSecret: oc
    .route(route("POST", "/git-providers/{providerId}/rotate-secret"))
    .input(
      z.object({
        providerId: IdSchema,
        reason: z.string().min(1).max(256),
        clientSecret: z.string().optional(),
        webhookSecret: z.string().optional(),
      }),
    )
    .output(GitProviderSchema)
    .errors({
      NOT_FOUND: { message: "Git provider not found" },
      BAD_REQUEST: { message: "Provide clientSecret or webhookSecret to rotate" },
    }),
};
