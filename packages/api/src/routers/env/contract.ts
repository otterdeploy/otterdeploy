import { oc } from "@orpc/contract";
import { createSelectSchema } from "drizzle-zod";
import * as z from "zod";

import { environment } from "@otterstack/db/schema";
import { ID_PREFIX, zId } from "@otterstack/shared/id";

const tag = "env";
const basePath = "/envs";

export const envSchema = createSelectSchema(environment).extend({
  id: zId(ID_PREFIX.environment),
  projectId: zId(ID_PREFIX.project).nullable(),
});

export const listEnvsInput = z
  .object({
    projectId: zId(ID_PREFIX.project).optional(),
  })
  .optional();

export const getEnvInput = z.object({
  id: zId(ID_PREFIX.environment),
});

export const createEnvInput = z.object({
  /** Optional client-supplied id for optimistic UI. */
  id: zId(ID_PREFIX.environment).optional(),
  name: z.string().min(1),
  slug: z.string().slugify().min(2).max(48),
  /**
   * Optional project to attach the env to on creation. When omitted, the env
   * is standalone and must be claimed later via `project.create`.
   */
  projectId: zId(ID_PREFIX.project).optional(),
});

export const deleteEnvInput = z.object({
  id: zId(ID_PREFIX.environment),
});

export const envContract = {
  list: oc
    .meta({ path: basePath, tag, method: "GET" })
    .input(listEnvsInput)
    .output(z.array(envSchema)),
  get: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Environment not found" as const },
    })
    .meta({ path: `${basePath}/{id}`, tag, method: "GET" })
    .input(getEnvInput)
    .output(envSchema),
  create: oc
    .errors({
      CONFLICT: { status: 409, message: "Environment slug already in use" as const },
      INTERNAL_SERVER_ERROR: {
        status: 500,
        message: "Environment create failed" as const,
        data: z.object({ cause: z.string() }),
      },
    })
    .meta({ path: basePath, tag, method: "POST" })
    .input(createEnvInput)
    .output(envSchema),
  delete: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Environment not found" as const },
    })
    .meta({ path: `${basePath}/{id}`, tag, method: "DELETE" })
    .input(deleteEnvInput)
    .output(z.object({ ok: z.boolean() })),
};
