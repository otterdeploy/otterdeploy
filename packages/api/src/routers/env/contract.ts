import { oc } from "@orpc/contract";
import { environment } from "@otterdeploy/db/schema";
import { createSelectSchema } from "drizzle-zod";
import * as z from "zod";

import {
  environmentSlugConflict,
  isEnvironmentSlugAllowed,
} from "../../lib/environment/reserved-slugs";
import { environmentIdField, projectIdField } from "../project/contract/shared";
const tag = "env";
const basePath = "/envs";

const envSchema = createSelectSchema(environment).extend({
  id: environmentIdField,
  projectId: projectIdField.nullable(),
});

const listEnvsInput = z
  .object({
    projectId: projectIdField.optional(),
  })
  .optional();

const getEnvInput = z.object({
  id: environmentIdField,
});

// Exported so the slug refinement can be tested at the boundary that actually
// enforces it, rather than only through the helper it delegates to.
export const createEnvInput = z.object({
  /** Optional client-supplied id for optimistic UI. */
  id: environmentIdField.optional(),
  name: z.string().min(1),
  // Refined, not just slugified: a slug shaped like `pr-7` would generate the
  // same container/volume/host names as PR #7's preview, and the two would
  // fight over them. See lib/environment/reserved-slugs.ts.
  slug: z
    .string()
    .slugify()
    .min(2)
    .max(48)
    .refine(isEnvironmentSlugAllowed, {
      error: (issue) => environmentSlugConflict(String(issue.input)) ?? "Reserved environment slug",
    }),
  /**
   * Optional project to attach the env to on creation. When omitted, the env
   * is standalone and must be claimed later via `project.create`.
   */
  projectId: projectIdField.optional(),
});

/**
 * Rename is name-only, deliberately.
 *
 * The SLUG is load-bearing: it is baked into every scoped runtime name —
 * container suffixes (`web-admin-staging`), internal hostnames
 * (`postgres-staging.<project>.otterdeploy.internal`), the environment's
 * overlay network, and the `environments.<slug>` key in the project manifest.
 * Changing it would leave every running container orphaned from its row, so
 * there is no slug field here rather than a slug field that half-works.
 */
const renameEnvInput = z.object({
  id: environmentIdField,
  name: z.string().min(1).max(64),
});

/**
 * Make every route in an environment private, or public again.
 *
 * Separate from `rename` rather than folded into a general `update`: this one
 * changes who can REACH the environment, and a combined patch would let a
 * rename quietly carry a protection change (or clear it by omission). A switch
 * that closes a door should be its own call, and its own audited event.
 */
const setEnvProtectionInput = z.object({
  id: environmentIdField,
  protected: z.boolean(),
});

const deleteEnvInput = z.object({
  id: environmentIdField,
  /** Delete the resources this environment owns along with it. Omitted or
   *  false, a non-empty environment is refused. See EnvironmentNotEmptyError. */
  cascade: z.boolean().optional(),
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
  rename: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Environment not found" as const },
    })
    .meta({ path: `${basePath}/{id}/rename`, tag, method: "POST" })
    .input(renameEnvInput)
    .output(envSchema),
  setProtection: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Environment not found" as const },
    })
    .meta({ path: `${basePath}/{id}/protection`, tag, method: "POST" })
    .input(setEnvProtectionInput)
    .output(envSchema),
  delete: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Environment not found" as const },
      // 409, not 400: the request is well-formed, the environment is simply not
      // in a state where it can be deleted yet. Re-sending with `cascade` is the
      // resolution, which is what a conflict means.
      CONFLICT: {
        status: 409,
        message: "Environment still owns resources. Confirm to delete them with it" as const,
      },
    })
    .meta({ path: `${basePath}/{id}`, tag, method: "DELETE" })
    .input(deleteEnvInput)
    .output(z.object({ ok: z.boolean() })),
};
