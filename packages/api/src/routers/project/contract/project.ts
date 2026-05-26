/**
 * Project CRUD — schemas + contract slice.
 */

import { oc } from "@orpc/contract";
import { createSelectSchema } from "drizzle-zod";
import * as z from "zod";

import { project } from "@otterstack/db/schema";
import { ID_PREFIX, zId, zSlug } from "@otterstack/shared/id";

import { basePath, projectNotFoundErrors, tag } from "./shared";

export const projectSchema = createSelectSchema(project)
  .omit({ organizationId: true })
  .extend({
    id: zId(ID_PREFIX.project),
    environmentId: zId(ID_PREFIX.environment).nullable(),
  });

export const projectListItemSchema = projectSchema.extend({
  databaseCount: z.number().int().nonnegative(),
});

export const createProjectInput = z.object({
  /**
   * Optional client-supplied project id. Lets the caller pre-allocate a CUID2
   * so optimistic UI rows match the persisted row (no flicker on refetch).
   * Server generates a fresh one when omitted.
   */
  id: zId(ID_PREFIX.project).optional(),
  /** Same idea for the default environment created alongside the project. */
  environmentId: zId(ID_PREFIX.environment).optional(),
  name: z.string().min(1),
  slug: z.string().slugify().min(2).max(48),
});

export const getProjectInput = z.object({
  id: zId(ID_PREFIX.project),
});

export const getProjectBySlugInput = z.object({
  slug: zSlug(ID_PREFIX.project),
});

export const updateProjectInput = z.object({
  id: zId(ID_PREFIX.project),
  name: z.string().min(1).optional(),
  slug: z.string().slugify().min(2).max(48).optional(),
});

export const deleteProjectInput = z.object({
  id: zId(ID_PREFIX.project),
});

export const projectContractSlice = {
  get: oc
    .errors(projectNotFoundErrors)
    .meta({ path: `${basePath}/{id}`, tag, method: "GET" })
    .input(getProjectInput)
    .output(projectSchema),
  getBySlug: oc
    .errors(projectNotFoundErrors)
    .meta({ path: `${basePath}/by-slug/{slug}`, tag, method: "GET" })
    .input(getProjectBySlugInput)
    .output(projectSchema),
  list: oc
    .meta({ path: basePath, tag, method: "GET" })
    .output(z.array(projectListItemSchema)),
  create: oc
    .errors({
      CONFLICT: { status: 409, message: "Project already exists" as const },
    })
    .meta({ path: basePath, tag, method: "POST" })
    .input(createProjectInput)
    .output(projectSchema),
  update: oc
    .errors({
      ...projectNotFoundErrors,
      CONFLICT: { status: 409, message: "Project slug already in use" as const },
    })
    .meta({ path: `${basePath}/{id}`, tag, method: "PATCH" })
    .input(updateProjectInput)
    .output(projectSchema),
  delete: oc
    .errors(projectNotFoundErrors)
    .meta({ path: `${basePath}/{id}`, tag, method: "DELETE" })
    .input(deleteProjectInput)
    .output(z.object({ ok: z.boolean() })),
};
