import { oc } from "@orpc/contract";
import * as z from "zod";

import { ID_PREFIX, zId } from "@otterstack/shared/id";

const tag = "project";
const basePath = "/projects";

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  environmentId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createProjectInput = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
});

export const getProjectInput = z.object({
  id: zId(ID_PREFIX.project),
});

export const postgresResourceSchema = z.object({
  resourceId: z.string(),
  projectId: z.string(),
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

export const proxyRouteSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  resourceId: z.string().nullable(),
  type: z.enum(["http", "layer4"]),
  domain: z.string(),
  upstreamHost: z.string(),
  upstreamPort: z.number().int().positive(),
  protocol: z.enum(["tcp", "http"]),
  layer4Alpn: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
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
    createPostgres: oc
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
    getPostgres: oc
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
    listPostgres: oc
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
    deletePostgres: oc
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
};
