import { oc } from "@orpc/contract";
import { createSelectSchema } from "drizzle-zod";
import * as z from "zod";

import { project, proxyRoute } from "@otterstack/db/schema";
import { ID_PREFIX, zId, zSlug } from "@otterstack/shared/id";

const tag = "project";
const basePath = "/projects";

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

export const postgresResourceSchema = z.object({
  resourceId: zId(ID_PREFIX.resource),
  projectId: zId(ID_PREFIX.project),
  name: z.string(),
  type: z.literal("database"),
  status: z.enum(["draft", "valid", "invalid"]),
  engine: z.literal("postgres"),
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
});

export const databaseResourceSchema = z.discriminatedUnion("engine", [
  postgresResourceSchema,
]);

/**
 * Minimal service view for the graph and resource list. D.1 keeps this slim
 * — ports / env vars / live task state are deferred to later sub-slices so
 * the list response stays cheap.
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
});

// All database engine variants are `type: "database"`. Spread so adding a new
// engine to databaseResourceSchema automatically widens resourceSchema too.
export const resourceSchema = z.discriminatedUnion("type", [
  ...databaseResourceSchema.options,
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
 * Generic per-resource endpoints — work the same for postgres databases,
 * services, and any future engine. The handler dispatches on resource kind
 * to source from the right storage (databaseResource.extraEnv vs
 * serviceEnvVar; pg container name vs serviceResource.serviceName).
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

// Env-key shape — Postgres-image friendly (libc convention). The derived
// POSTGRES_USER / PASSWORD / DB keys are reserved: setting them via the editor
// is rejected so the database identity stays a single source of truth.
const POSTGRES_RESERVED_ENV_KEYS = new Set([
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
]);
const envKeyShape = z
  .string()
  .min(1)
  .regex(/^[A-Z_][A-Z0-9_]*$/, "must be UPPER_SNAKE_CASE")
  .refine((k) => !POSTGRES_RESERVED_ENV_KEYS.has(k), {
    message:
      "POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD are reserved — use the rotation flow to change credentials.",
  });

export const setPostgresExtraEnvInput = z.object({
  projectId: zId(ID_PREFIX.project),
  resourceId: zId(ID_PREFIX.resource),
  key: envKeyShape,
  value: z.string().max(8192),
});

export const unsetPostgresExtraEnvInput = z.object({
  projectId: zId(ID_PREFIX.project),
  resourceId: zId(ID_PREFIX.resource),
  key: envKeyShape,
});

// Engine-specific create inputs (kept; reads/deletes are generic via resource.*)
export const createPostgresDatabaseInput = z.object({
  projectId: zId(ID_PREFIX.project),
  name: z.string().min(1),
  /** Whether the DB should be reachable from the public internet via the
   *  Caddy proxy. Defaults to false — internal-only is the safe default. */
  publicEnabled: z.boolean().optional().default(false),
});

export const getPostgresDatabaseInput = z.object({
  projectId: zId(ID_PREFIX.project),
  resourceId: zId(ID_PREFIX.resource),
});

/** Flip the public-exposure flag on an existing postgres resource. The
 *  Caddy reconciler runs after the toggle so the route state catches up. */
export const setPostgresPublicInput = z.object({
  projectId: zId(ID_PREFIX.project),
  resourceId: zId(ID_PREFIX.resource),
  publicEnabled: z.boolean(),
});

export const deletePostgresDatabaseInput = z.object({
  projectId: zId(ID_PREFIX.project),
  resourceId: zId(ID_PREFIX.resource),
});

export const listPostgresDatabasesInput = z.object({
  projectId: zId(ID_PREFIX.project),
});

export const reconcileResultSchema = z.object({
  applied: z.array(z.string()),
  skipped: z.array(
    z.object({
      projectId: z.string(),
      error: z.string(),
    }),
  ),
  revision: z.string(),
  loadError: z.string().optional(),
});

export const proxyRouteSchema = createSelectSchema(proxyRoute).extend({
  id: zId(ID_PREFIX.proxyRoute),
  projectId: zId(ID_PREFIX.project),
  resourceId: zId(ID_PREFIX.resource).nullable(),
});

export const listProxyRoutesInput = z.object({
  projectId: zId(ID_PREFIX.project),
});

/**
 * One directed edge in the project's resource dependency graph. Derived from
 * `${{<Resource>.<VAR>}}` references inside service env vars by the resolver
 * — service A consuming POSTGRES.URL emits `{ source: A, target: POSTGRES }`.
 */
export const dependencyEdgeSchema = z.object({
  source: zId(ID_PREFIX.resource),
  target: zId(ID_PREFIX.resource),
});

export const listDependenciesInput = z.object({
  projectId: zId(ID_PREFIX.project),
});

/**
 * Live state of one swarm task. `state` is the high-level bucket used by the
 * graph (running / building / error); finer-grained docker states are
 * collapsed into these so the UI doesn't have to know about preparing /
 * accepted / orphaned distinctions.
 */
export const serviceTaskSchema = z.object({
  id: z.string(),
  slot: z.number().int().nullable(),
  /** "<serviceName>.<slot>", e.g. "api.1". Matches docker's display name. */
  label: z.string(),
  state: z.enum(["running", "building", "error"]),
  /** Swarm node id the task was scheduled onto, or null if unscheduled. */
  nodeId: z.string().nullable(),
  /** Last reported message from the orchestrator. */
  message: z.string().nullable(),
  timestamp: z.string().nullable(),
});

export const serviceTasksSchema = z.object({
  resourceId: zId(ID_PREFIX.resource),
  tasks: z.array(serviceTaskSchema),
});

export const listServiceTasksInput = z.object({
  projectId: zId(ID_PREFIX.project),
});

export const projectContract = {
  get: oc
    .errors({
      NOT_FOUND: {
        status: 404,
        message: "Project not found" as const,
      },
    })
    .meta({
      path: `${basePath}/{id}`,
      tag,
      method: "GET",
    })
    .input(getProjectInput)
    .output(projectSchema),
  getBySlug: oc
    .errors({
      NOT_FOUND: {
        status: 404,
        message: "Project not found" as const,
      },
    })
    .meta({
      path: `${basePath}/by-slug/{slug}`,
      tag,
      method: "GET",
    })
    .input(getProjectBySlugInput)
    .output(projectSchema),
  list: oc
    .meta({
      path: basePath,
      tag,
      method: "GET",
    })
    .output(z.array(projectListItemSchema)),
  create: oc
    .errors({
      CONFLICT: {
        status: 409,
        message: "Project already exists" as const,
      },
    })
    .meta({
      path: basePath,
      tag,
      method: "POST",
    })
    .input(createProjectInput)
    .output(projectSchema),
  update: oc
    .errors({
      NOT_FOUND: {
        status: 404,
        message: "Project not found" as const,
      },
      CONFLICT: {
        status: 409,
        message: "Project slug already in use" as const,
      },
    })
    .meta({
      path: `${basePath}/{id}`,
      tag,
      method: "PATCH",
    })
    .input(updateProjectInput)
    .output(projectSchema),
  delete: oc
    .errors({
      NOT_FOUND: {
        status: 404,
        message: "Project not found" as const,
      },
    })
    .meta({
      path: `${basePath}/{id}`,
      tag,
      method: "DELETE",
    })
    .input(deleteProjectInput)
    .output(z.object({ ok: z.boolean() })),
  proxyRoute: {
    list: oc
      .errors({
        NOT_FOUND: {
          status: 404,
          message: "Project not found" as const,
        },
      })
      .meta({
        path: `${basePath}/{projectId}/proxy-routes`,
        tag,
        method: "GET",
      })
      .input(listProxyRoutesInput)
      .output(z.array(proxyRouteSchema)),
  },
  dependencies: oc
    .errors({
      NOT_FOUND: {
        status: 404,
        message: "Project not found" as const,
      },
    })
    .meta({
      path: `${basePath}/{projectId}/dependencies`,
      tag,
      method: "GET",
    })
    .input(listDependenciesInput)
    .output(z.array(dependencyEdgeSchema)),
  serviceTasks: oc
    .errors({
      NOT_FOUND: {
        status: 404,
        message: "Project not found" as const,
      },
    })
    .meta({
      path: `${basePath}/{projectId}/service-tasks`,
      tag,
      method: "GET",
    })
    .input(listServiceTasksInput)
    .output(z.array(serviceTasksSchema)),
  resource: {
    list: oc
      .errors({
        NOT_FOUND: {
          status: 404,
          message: "Project not found" as const,
        },
      })
      .meta({
        path: `${basePath}/{projectId}/resources`,
        tag,
        method: "GET",
      })
      .input(listProjectResourcesInput)
      .output(z.array(resourceSchema)),

    checkName: oc
      .errors({
        NOT_FOUND: {
          status: 404,
          message: "Project not found" as const,
        },
      })
      .meta({
        path: `${basePath}/{projectId}/resources/check-name`,
        tag,
        method: "GET",
      })
      .input(checkResourceNameInput)
      .output(checkResourceNameSchema),

    tasks: oc
      .errors({
        NOT_FOUND: {
          status: 404,
          message: "Resource not found" as const,
        },
      })
      .meta({
        path: `${basePath}/{projectId}/resources/{resourceId}/tasks`,
        tag,
        method: "GET",
      })
      .input(resourceTaskInput)
      .output(z.array(serviceTaskSchema)),

    env: {
      list: oc
        .errors({
          NOT_FOUND: {
            status: 404,
            message: "Resource not found" as const,
          },
        })
        .meta({
          path: `${basePath}/{projectId}/resources/{resourceId}/env`,
          tag,
          method: "GET",
        })
        .input(resourceEnvListInput)
        .output(z.array(resourceEnvEntrySchema)),

      bulkSet: oc
        .errors({
          NOT_FOUND: {
            status: 404,
            message: "Resource not found" as const,
          },
        })
        .meta({
          path: `${basePath}/{projectId}/resources/{resourceId}/env`,
          tag,
          method: "PUT",
        })
        .input(resourceEnvBulkSetInput)
        .output(z.array(resourceEnvEntrySchema)),
    },

    get: oc
      .errors({
        NOT_FOUND: {
          status: 404,
          message: "Resource not found" as const,
        },
      })
      .meta({
        path: `${basePath}/{projectId}/resources/{resourceId}`,
        tag,
        method: "GET",
      })
      .input(getProjectResourceInput)
      .output(resourceSchema),

    delete: oc
      .errors({
        NOT_FOUND: {
          status: 404,
          message: "Resource not found" as const,
        },
      })
      .meta({
        path: `${basePath}/{projectId}/resources/{resourceId}`,
        tag,
        method: "DELETE",
      })
      .input(deleteProjectResourceInput)
      .output(z.object({ ok: z.boolean() })),

    database: {
      postgres: {
        create: oc
          .errors({
            NOT_FOUND: {
              status: 404,
              message: "Project not found" as const,
            },
            CONFLICT: {
              status: 409,
              message: "Database resource already exists" as const,
            },
          })
          .meta({
            path: `${basePath}/{projectId}/resources/database/postgres`,
            tag,
            method: "POST",
          })
          .input(createPostgresDatabaseInput)
          .output(postgresResourceSchema),

        setPublic: oc
          .errors({
            NOT_FOUND: {
              status: 404,
              message: "Resource not found" as const,
            },
          })
          .meta({
            path: `${basePath}/{projectId}/resources/database/postgres/{resourceId}/public`,
            tag,
            method: "PATCH",
          })
          .input(setPostgresPublicInput)
          .output(postgresResourceSchema),

        setExtraEnv: oc
          .errors({
            NOT_FOUND: { status: 404, message: "Resource not found" as const },
            INVALID_INPUT: {
              status: 400,
              message: "Invalid env key or value" as const,
            },
          })
          .meta({
            path: `${basePath}/{projectId}/resources/database/postgres/{resourceId}/env/{key}`,
            tag,
            method: "PUT",
          })
          .input(setPostgresExtraEnvInput)
          .output(postgresResourceSchema),

        unsetExtraEnv: oc
          .errors({
            NOT_FOUND: { status: 404, message: "Resource not found" as const },
          })
          .meta({
            path: `${basePath}/{projectId}/resources/database/postgres/{resourceId}/env/{key}`,
            tag,
            method: "DELETE",
          })
          .input(unsetPostgresExtraEnvInput)
          .output(postgresResourceSchema),
      },
    },
  },
};
