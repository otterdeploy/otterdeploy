/**
 * Generic resource schemas + base inputs.
 *
 * Resource = either a database (postgres today) or a service. The discriminated
 * union here is the single shape returned by `project.resource.list` and
 * `project.resource.get`. Postgres-specific schemas live in `./postgres`.
 *
 * The "generic" per-resource endpoints (tasks, env, get, delete, checkName,
 * list) live in this file's contract slice — handler dispatches on kind to
 * source from the right storage.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";

import { ID_PREFIX, zId } from "@otterstack/shared/id";

import {
  basePath,
  projectNotFoundErrors,
  resourceNotFoundErrors,
  tag,
} from "./shared";

// Renamed conceptually from postgresResourceSchema to "database resource
// schema" — the shape is the same across engines (a record with credentials
// + a set of connection strings), the engine field just enumerates which
// engine produced those strings. The export alias below keeps the
// `postgresResourceSchema` import name compiling.
export const databaseResourceSchema = z.object({
  resourceId: zId(ID_PREFIX.resource),
  projectId: zId(ID_PREFIX.project),
  name: z.string(),
  type: z.literal("database"),
  status: z.enum(["draft", "valid", "invalid"]),
  engine: z.enum(["postgres", "redis", "mariadb", "mongodb"]),
  databaseName: z.string(),
  username: z.string(),
  password: z.string(),
  /** When false, the public hostname exists but isn't wired through Caddy
   *  — the DB is only reachable on the internal network. */
  publicEnabled: z.boolean(),
  publicHostname: z.string(),
  publicPort: z.number().int().positive(),
  publicConnectionString: z.string(),
  internalHostname: z.string(),
  internalPort: z.number().int().positive(),
  internalConnectionString: z.string(),
  localConnectionString: z.string().nullable(),
  upstreamHost: z.string(),
  upstreamPort: z.number().int().positive(),
  runtime: z.object({
    serviceId: z.string().nullable(),
    serviceName: z.string(),
    volumeName: z.string(),
    networkName: z.string(),
    status: z.enum(["running", "starting", "stopped", "missing", "error"]),
    health: z.enum(["healthy", "unhealthy", "starting"]).nullable(),
  }),
  // User-added envs injected into the Postgres container at deploy time.
  // Editable via project.resource.database.postgres.env.{set,unset}.
  extraEnv: z.record(z.string(), z.string()),
  // Keys the operator flagged as sensitive — display hint for the editor
  // to mask the value behind a reveal toggle. Always present (default []).
  secretKeys: z.array(z.string()),
});

// Legacy alias for callers that still import the postgres-named schema.
// Same object, just a different name — drop once all imports rename.
export const postgresResourceSchema = databaseResourceSchema;

/**
 * Minimal service view for the graph and resource list. Keeps the list
 * response cheap — ports / env vars / live task state are deferred to
 * later sub-slices.
 */
export const serviceResourceSchema = z.object({
  resourceId: zId(ID_PREFIX.resource),
  projectId: zId(ID_PREFIX.project),
  name: z.string(),
  type: z.literal("service"),
  status: z.enum(["draft", "valid", "invalid"]),
  image: z.string(),
  imageDigest: z.string().nullable(),
  replicas: z.number().int().min(0),
  publicEnabled: z.boolean(),
  publicDomain: z.string().nullable(),
  // Manifest-tracked extras (Phase 2 of build config + lifecycle work).
  // Nullable + optional so consumers that don't care can ignore them;
  // surfaced in the list response so the resource panel can show them
  // without a second fetch.
  preDeploy: z.array(z.string()).nullable().optional(),
  buildConfig: z.unknown().nullable().optional(),
  restartWindowMs: z.number().int().nullable().optional(),
  diskLimitMb: z.number().int().nullable().optional(),
  swapLimitMb: z.number().int().nullable().optional(),
  pidsLimit: z.number().int().nullable().optional(),
});

// `type` discriminates database vs service. The engine field on database
// rows is a plain enum (not nested discriminators) — engines share the
// same record shape, just produce different connection-string formats.
export const resourceSchema = z.discriminatedUnion("type", [
  databaseResourceSchema,
  serviceResourceSchema,
]);

export const listProjectResourcesInput = z.object({
  projectId: zId(ID_PREFIX.project),
});

export const getProjectResourceInput = z.object({
  projectId: zId(ID_PREFIX.project),
  resourceId: zId(ID_PREFIX.resource),
});

export const deleteProjectResourceInput = z.object({
  projectId: zId(ID_PREFIX.project),
  resourceId: zId(ID_PREFIX.resource),
});

/**
 * Generic per-resource endpoints — same shape for postgres databases,
 * services, and any future engine. Handler dispatches on resource kind.
 */
export const resourceTaskInput = z.object({
  projectId: zId(ID_PREFIX.project),
  resourceId: zId(ID_PREFIX.resource),
});

export const resourceEnvEntrySchema = z.object({
  key: z.string(),
  value: z.string(),
});

export const resourceEnvListInput = z.object({
  projectId: zId(ID_PREFIX.project),
  resourceId: zId(ID_PREFIX.resource),
});

export const resourceEnvBulkSetInput = z.object({
  projectId: zId(ID_PREFIX.project),
  resourceId: zId(ID_PREFIX.resource),
  env: z.array(resourceEnvEntrySchema),
  // Keys to mark as sensitive — server stores this as a display hint;
  // values still travel the wire in plain. Optional so callers that don't
  // care about masking can omit it.
  secretKeys: z.array(z.string()).optional(),
});

/**
 * Live name-availability check for the new-resource wizard. Used by the
 * Service name field's onBlur validator and to pre-fill a free default
 * when the page mounts. `suggestion` is non-null only when `available` is
 * false — derived by suffixing "-2", "-3", … until free.
 */
export const checkResourceNameInput = z.object({
  projectId: zId(ID_PREFIX.project),
  name: z.string().min(1),
});

export const checkResourceNameSchema = z.object({
  available: z.boolean(),
  suggestion: z.string().nullable(),
});

// Imported by the slice below — see ./service-tasks for the schema definition.
import { serviceTaskSchema } from "./service-tasks";

/**
 * Router slice for the generic resource endpoints — list, checkName, tasks,
 * env CRUD, get, delete. Composed into `projectContract.resource` along
 * with the streaming logs slice and the postgres-specific sub-slice.
 */
export const resourceContractSlice = {
  list: oc
    .errors(projectNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/resources`,
      tag,
      method: "GET",
    })
    .input(listProjectResourcesInput)
    .output(z.array(resourceSchema)),

  checkName: oc
    .errors(projectNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/resources/check-name`,
      tag,
      method: "GET",
    })
    .input(checkResourceNameInput)
    .output(checkResourceNameSchema),

  tasks: oc
    .errors(resourceNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/resources/{resourceId}/tasks`,
      tag,
      method: "GET",
    })
    .input(resourceTaskInput)
    .output(z.array(serviceTaskSchema)),

  env: {
    list: oc
      .errors(resourceNotFoundErrors)
      .meta({
        path: `${basePath}/{projectId}/resources/{resourceId}/env`,
        tag,
        method: "GET",
      })
      .input(resourceEnvListInput)
      .output(z.array(resourceEnvEntrySchema)),

    bulkSet: oc
      .errors(resourceNotFoundErrors)
      .meta({
        path: `${basePath}/{projectId}/resources/{resourceId}/env`,
        tag,
        method: "PUT",
      })
      .input(resourceEnvBulkSetInput)
      .output(z.array(resourceEnvEntrySchema)),
  },

  get: oc
    .errors(resourceNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/resources/{resourceId}`,
      tag,
      method: "GET",
    })
    .input(getProjectResourceInput)
    .output(resourceSchema),

  delete: oc
    .errors(resourceNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/resources/{resourceId}`,
      tag,
      method: "DELETE",
    })
    .input(deleteProjectResourceInput)
    .output(z.object({ ok: z.boolean() })),
};
