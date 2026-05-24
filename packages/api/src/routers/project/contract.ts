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
});

export const createPostgresDatabaseInput = z.object({
  projectId: zId(ID_PREFIX.project),
  name: z.string().min(1),
});

export const getPostgresDatabaseInput = z.object({
  projectId: zId(ID_PREFIX.project),
  resourceId: zId(ID_PREFIX.resource),
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
    .output(z.array(projectSchema)),
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
          path: `${basePath}/{projectId}/databases/postgres`,
          tag,
          method: "POST",
        })
        .input(createPostgresDatabaseInput)
        .output(postgresResourceSchema),
      get: oc
        .errors({
          NOT_FOUND: {
            status: 404,
            message: "Database resource not found" as const,
          },
        })
        .meta({
          path: `${basePath}/{projectId}/databases/{resourceId}`,
          tag,
          method: "GET",
        })
        .input(getPostgresDatabaseInput)
        .output(postgresResourceSchema),
      list: oc
        .errors({
          NOT_FOUND: {
            status: 404,
            message: "Project not found" as const,
          },
        })
        .meta({
          path: `${basePath}/{projectId}/databases`,
          tag,
          method: "GET",
        })
        .input(listPostgresDatabasesInput)
        .output(z.array(postgresResourceSchema)),
      delete: oc
        .errors({
          NOT_FOUND: {
            status: 404,
            message: "Database resource not found" as const,
          },
        })
        .meta({
          path: `${basePath}/{projectId}/databases/{resourceId}`,
          tag,
          method: "DELETE",
        })
        .input(deletePostgresDatabaseInput)
        .output(z.object({ ok: z.boolean() })),
    },
  },
};
