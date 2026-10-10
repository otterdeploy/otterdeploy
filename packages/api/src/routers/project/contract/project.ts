import { oc } from "@orpc/contract";
import { project } from "@otterdeploy/db/schema";
/**
 * Project CRUD: schemas + contract slice.
 */
import { ID_PREFIX, zId, zSlug } from "@otterdeploy/shared/id";
import { reservedSlugConflict } from "@otterdeploy/shared/reserved-slugs";
import { createSelectSchema } from "drizzle-zod";
import * as z from "zod";

import { projectRefs } from "../../../authz/project-refs";
import { basePath, projectNotFoundErrors, tag } from "./shared";
import { environmentIdField, projectIdField } from "./shared";

// Every branded id column on the `project` row is re-emitted here as a
// typed `<X>IdField` rather than the `z.string()` drizzle-zod would
// otherwise produce. drizzle-zod 1.0-beta14 drops `$type` brands when
// it generates schemas for `text` columns (only `json/jsonb` reads
// `_.data`), so without these overrides the wire shape loses the brand
// and the React hover ends up showing a plain `string` for ids that
// should carry their nominal type end-to-end.
/** Operator-arranged graph layout: node id (`${kind}:${name}`) → {x,y}. */
const graphLayoutSchema = z.record(z.string(), z.object({ x: z.number(), y: z.number() }));

export const projectSchema = createSelectSchema(project)
  // Manifest payloads are read through `project.manifest.get`, not embedded
  // in every project row: keeps list/get cheap and avoids shipping a
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
    // Dedicated build server for this project's services (nullable = build
    // wherever they run). Branded so the id keeps its nominal type end-to-end.
    buildServerId: zId(ID_PREFIX.server).nullable(),
    // drizzle-zod infers jsonb loosely; pin the wire shape explicitly so the
    // graph reads a typed `Record<nodeId, {x,y}>`.
    graphLayout: graphLayoutSchema,
  });

/**
 * A slug chosen at create or rename: normalized, bounded, and not one the
 * dashboard already answers beside it (`@otterdeploy/shared/reserved-slugs`).
 * Reading an existing slug uses `zSlug` instead, which must keep accepting
 * slugs taken before a word was reserved.
 */
const projectSlugInput = z
  .string()
  .slugify()
  .min(2)
  .max(48)
  .refine((slug) => reservedSlugConflict("project", slug) === null, {
    error: (issue) =>
      reservedSlugConflict("project", String(issue.input)) ?? "Reserved project slug",
  });

export const projectListItemSchema = projectSchema.extend({
  databaseCount: z.number().int().nonnegative(),
  // service + compose resources (the authored "services" in the project).
  serviceCount: z.number().int().nonnegative(),
  // enabled proxy routes.
  routeCount: z.number().int().nonnegative(),
  // How many of `serviceCount` have a live container right now, or `null` when
  // the runtime (docker) couldn't be reached for this list. The UI then shows
  // the configured total without a running fraction.
  runningServiceCount: z.number().int().nonnegative().nullable(),
});

/**
 * Nixpacks build configuration knobs exposed via the project settings
 * UI. Mirrors the `NixpacksConfig` interface in the DB schema; defined
 * here so the contract carries the wire shape without needing to
 * import from the schema package directly.
 */
const nixpacksConfigSchema = z.object({
  buildCmd: z.string().optional(),
  startCmd: z.string().optional(),
  installCmd: z.string().optional(),
  packages: z.array(z.string()).optional(),
  aptPackages: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const createProjectInput = z.object({
  /**
   * Optional client-supplied project id. Lets the caller pre-allocate a CUID2
   * so optimistic UI rows match the persisted row (no flicker on refetch).
   * Server generates a fresh one when omitted.
   */
  id: projectIdField.optional(),
  /**
   * The project's main environment: a standalone one this org made with
   * `env.create` (claimed), or a fresh id (created under it). Anything else is
   * refused with ENVIRONMENT_UNAVAILABLE. Generated when omitted.
   */
  environmentId: environmentIdField.optional(),
  name: z.string().min(1),
  slug: projectSlugInput,
});

export const getProjectInput = z.object({
  id: projectIdField,
});

const getProjectBySlugInput = z.object({
  slug: zSlug(ID_PREFIX.project),
});

const updateProjectInput = z.object({
  id: projectIdField,
  name: z.string().min(1).optional(),
  slug: projectSlugInput.optional(),
  // Per-project custom domain. Setting this changes where the project's
  // services land (web.<customDomain> instead of falling through to the
  // org's baseDomain). Writing the column clears any previous
  // verification; the verify-token + verified-at columns get reset by
  // the handler so the operator can't bind an unverified domain and
  // skip the check. `null` clears (falls back to org default).
  customDomain: z.string().min(1).max(253).nullable().optional(),
  // PR-preview opt-in moved to the SERVICE (serviceResource.previewsEnabled,
  // manifest `previews`): the preview unit is the resource, not the project.
  // Git repo + image target moved to the service (edited via the service's
  // Source card, staged into the manifest). The project update no longer
  // carries a repo/registry binding.
  nixpacksConfig: nixpacksConfigSchema.nullable().optional(),
  // Dedicated build server for this project's services. `null` clears it
  // (build wherever each service runs). A service can still override it.
  buildServerId: zId(ID_PREFIX.server).nullable().optional(),
});

const deleteProjectInput = z.object({
  id: projectIdField,
});

const saveGraphLayoutInput = z.object({
  id: projectIdField,
  // Partial map. Only the nodes that moved. Merged into the stored layout
  // server-side so other nodes' positions are preserved.
  positions: graphLayoutSchema,
  // When true, `positions` REPLACES the stored layout instead of merging into
  // it: `{}` clears every saved position. Powers the graph's "re-run layout"
  // action, which hands placement back to dagre.
  replace: z.boolean().optional(),
});

/**
 * Create/rename hit a slug some project on this install already holds (slugs
 * are unique across ALL organizations). `suggestedSlug` is a free
 * alternative the client can offer as-is.
 */
const projectSlugConflictError = {
  status: 409,
  message: "Project slug already in use",
  data: z.object({ slug: z.string(), suggestedSlug: z.string() }),
} as const;

export const projectContractSlice = {
  get: oc
    .meta(projectRefs({ id: "project" }))
    .errors(projectNotFoundErrors)
    .meta({ path: `${basePath}/{id}`, tag, method: "GET" })
    .input(getProjectInput)
    .output(projectSchema),
  getBySlug: oc
    .meta(projectRefs({ slug: "projectSlug" }))
    .errors(projectNotFoundErrors)
    .meta({ path: `${basePath}/by-slug/{slug}`, tag, method: "GET" })
    .input(getProjectBySlugInput)
    .output(projectSchema),
  list: oc.meta({ path: basePath, tag, method: "GET" }).output(z.array(projectListItemSchema)),
  create: oc
    .meta(projectRefs({ id: "none" }))
    .errors({
      CONFLICT: projectSlugConflictError,
      // The supplied `environmentId` may not be claimed: another
      // project holds it, or it is another org's standalone environment. One
      // answer for all of them, so it says nothing about who owns the id.
      ENVIRONMENT_UNAVAILABLE: {
        status: 409,
        message: "Environment cannot be claimed by this project" as const,
      },
    })
    .meta({ path: basePath, tag, method: "POST" })
    .input(createProjectInput)
    .output(projectSchema),
  update: oc
    .meta(projectRefs({ id: "project" }))
    .errors({
      ...projectNotFoundErrors,
      CONFLICT: projectSlugConflictError,
    })
    .meta({ path: `${basePath}/{id}`, tag, method: "PATCH" })
    .input(updateProjectInput)
    .output(projectSchema),
  delete: oc
    .meta(projectRefs({ id: "project" }))
    .errors({
      ...projectNotFoundErrors,
      // Refused while service/compose resources exist. Their runtimes are
      // only reclaimed by the per-resource delete path, so a project delete
      // underneath them would orphan containers/images on the host.
      CONFLICT: {
        status: 409,
        message: "Project still has services. Delete them first" as const,
        data: z.object({ serviceCount: z.number().int().nonnegative() }),
      },
    })
    .meta({ path: `${basePath}/{id}`, tag, method: "DELETE" })
    .input(deleteProjectInput)
    .output(z.object({ ok: z.boolean() })),
  saveGraphLayout: oc
    .meta(projectRefs({ id: "project" }))
    .errors(projectNotFoundErrors)
    .meta({ path: `${basePath}/{id}/graph-layout`, tag, method: "PATCH" })
    .input(saveGraphLayoutInput)
    .output(z.object({ ok: z.boolean() })),
};
