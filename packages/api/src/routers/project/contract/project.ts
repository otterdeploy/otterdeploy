/**
 * Project CRUD — schemas + contract slice.
 */
import { ID_PREFIX, zSlug } from "@otterdeploy/shared/id";

import { oc } from "@orpc/contract";
import { createSelectSchema } from "drizzle-zod";
import * as z from "zod";

import { project } from "@otterdeploy/db/schema";
import { basePath, projectNotFoundErrors, tag } from "./shared";
import { containerRegistryIdField, environmentIdField, gitRepoIdField, projectIdField } from "./shared";

export const projectSchema = createSelectSchema(project)
  // Manifest payloads are read through `project.manifest.get`, not embedded
  // in every project row — keeps list/get cheap and avoids shipping a
  // potentially large jsonb on every navigation.
  .omit({
    organizationId: true,
    manifest: true,
    manifestVersion: true,
    lastAppliedManifest: true,
    lastManifestAppliedAt: true,
  })
  .extend({
    id: projectIdField,
    environmentId: environmentIdField.nullable(),
  });

export const projectListItemSchema = projectSchema.extend({
  databaseCount: z.number().int().nonnegative(),
});

/**
 * Nixpacks build configuration knobs exposed via the project settings
 * UI. Mirrors the `NixpacksConfig` interface in the DB schema; defined
 * here so the contract carries the wire shape without needing to
 * import from the schema package directly.
 */
export const nixpacksConfigSchema = z.object({
  buildCmd: z.string().optional(),
  startCmd: z.string().optional(),
  installCmd: z.string().optional(),
  packages: z.array(z.string()).optional(),
  aptPackages: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const createProjectInput = z.object({
  /**
   * Optional client-supplied project id. Lets the caller pre-allocate a CUID2
   * so optimistic UI rows match the persisted row (no flicker on refetch).
   * Server generates a fresh one when omitted.
   */
  id: projectIdField.optional(),
  /** Same idea for the default environment created alongside the project. */
  environmentId: environmentIdField.optional(),
  name: z.string().min(1),
  slug: z.string().slugify().min(2).max(48),
});

export const getProjectInput = z.object({
  id: projectIdField,
});

export const getProjectBySlugInput = z.object({
  slug: zSlug(ID_PREFIX.project),
});

export const updateProjectInput = z.object({
  id: projectIdField,
  name: z.string().min(1).optional(),
  slug: z.string().slugify().min(2).max(48).optional(),
  // Build pipeline binding. Each field is independently optional;
  // `null` clears the column, `undefined` leaves it unchanged. The
  // handler validates FK rows belong to the same org.
  gitRepoId: gitRepoIdField.nullable().optional(),
  productionBranch: z.string().min(1).max(255).optional(),
  containerRegistryId: containerRegistryIdField.nullable().optional(),
  imageRepository: z.string().min(1).max(255).nullable().optional(),
  nixpacksConfig: nixpacksConfigSchema.nullable().optional(),
});

export const deleteProjectInput = z.object({
  id: projectIdField,
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
      INVALID_BINDING: {
        status: 400,
        message:
          "Referenced git repo or registry doesn't belong to this organization" as const,
      },
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
