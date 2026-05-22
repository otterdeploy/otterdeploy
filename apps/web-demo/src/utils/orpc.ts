import type { AppRouterClient } from "@otterstack/api/routers/index";

import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      toast.error(`Error: ${error.message}`, {
        action: {
          label: "retry",
          onClick: query.invalidate,
        },
      });
    },
  }),
});

type Project = Awaited<ReturnType<AppRouterClient["project"]["get"]>>;
type Database = Awaited<ReturnType<AppRouterClient["project"]["database"]["listPostgres"]>>[number];
type ProxyRoute = Awaited<ReturnType<AppRouterClient["project"]["proxyRoute"]["list"]>>[number];

const now = "2026-05-01T00:00:00Z";

const mockProjects: Project[] = [
  {
    id: "proj_acme",
    name: "Acme API",
    slug: "acme-api",
    environmentId: "env_acme_dev",
    createdAt: now,
    updatedAt: now,
  } as Project,
  {
    id: "proj_otters",
    name: "Otters Web",
    slug: "otters-web",
    environmentId: "env_otters_dev",
    createdAt: now,
    updatedAt: now,
  } as Project,
  {
    id: "proj_marketing",
    name: "Marketing Site",
    slug: "marketing-site",
    environmentId: "env_marketing_dev",
    createdAt: now,
    updatedAt: now,
  } as Project,
];

function makeDatabase(over: Partial<Database>): Database {
  return {
    resourceId: "res_db_primary",
    projectId: "proj_acme",
    name: "primary",
    type: "database",
    status: "valid",
    engine: "postgres",
    databaseName: "app",
    username: "admin",
    password: "secret",
    publicHostname: "primary.acme.local",
    publicPort: 5432,
    publicConnectionString: "postgres://admin:secret@primary.acme.local:5432/app",
    internalHostname: "primary.internal",
    internalPort: 5432,
    internalConnectionString: "postgres://admin:secret@primary.internal:5432/app",
    localConnectionString: null,
    upstreamHost: "primary",
    upstreamPort: 5432,
    runtime: {
      serviceId: "svc_primary",
      serviceName: "primary",
      volumeName: "primary-data",
      networkName: "acme",
      status: "running",
      health: "healthy",
    },
    ...over,
  } as Database;
}

function makeRoute(over: Partial<ProxyRoute>): ProxyRoute {
  return {
    id: "rt_default",
    projectId: "proj_acme",
    resourceId: null,
    type: "http",
    domain: "acme.example.com",
    upstreamHost: "primary",
    upstreamPort: 5432,
    protocol: "http",
    layer4Alpn: null,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...over,
  } as ProxyRoute;
}

const mockDatabasesByProject: Record<string, Database[]> = {
  proj_acme: [
    makeDatabase({ resourceId: "res_db_primary", name: "primary" }),
    makeDatabase({
      resourceId: "res_db_replica",
      name: "replica",
      runtime: {
        serviceId: "svc_replica",
        serviceName: "replica",
        volumeName: "replica-data",
        networkName: "acme",
        status: "running",
        health: "healthy",
      },
    }),
  ],
  proj_otters: [makeDatabase({ resourceId: "res_db_otters", projectId: "proj_otters", name: "main" })],
  proj_marketing: [],
};

const mockRoutesByProject: Record<string, ProxyRoute[]> = {
  proj_acme: [
    makeRoute({ id: "rt_acme_api", projectId: "proj_acme", domain: "api.acme.com" }),
    makeRoute({ id: "rt_acme_app", projectId: "proj_acme", domain: "app.acme.com", upstreamHost: "web", upstreamPort: 3000 }),
  ],
  proj_otters: [
    makeRoute({ id: "rt_otters_app", projectId: "proj_otters", domain: "otters.example.com", upstreamHost: "web", upstreamPort: 3000 }),
  ],
  proj_marketing: [],
};

function delay<T>(value: T, ms = 120): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function findProject(id: string): Project {
  const project = mockProjects.find((p) => p.id === id);
  if (!project) throw new Error(`Mock project not found: ${id}`);
  return project;
}

function findDatabase(projectId: string, resourceId: string): Database {
  const list = mockDatabasesByProject[projectId] ?? [];
  const db = list.find((d) => d.resourceId === resourceId);
  if (!db) throw new Error(`Mock database not found: ${projectId}/${resourceId}`);
  return db;
}

const mockClient = {
  project: {
    list: () => delay([...mockProjects]),
    get: ({ projectId }: { projectId: string }) => delay(findProject(projectId)),
    create: ({ name, slug }: { name: string; slug: string }) => {
      const id = `proj_${slug || Math.random().toString(36).slice(2, 8)}`;
      const created = {
        id,
        name,
        slug,
        environmentId: `env_${id}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as Project;
      mockProjects.push(created);
      mockDatabasesByProject[id] = [];
      mockRoutesByProject[id] = [];
      return delay(created);
    },
    database: {
      listPostgres: ({ projectId }: { projectId: string }) => delay([...(mockDatabasesByProject[projectId] ?? [])]),
      getPostgres: ({ projectId, resourceId }: { projectId: string; resourceId: string }) =>
        delay(findDatabase(projectId, resourceId)),
      deletePostgres: ({ projectId, resourceId }: { projectId: string; resourceId: string }) => {
        const list = mockDatabasesByProject[projectId] ?? [];
        mockDatabasesByProject[projectId] = list.filter((d) => d.resourceId !== resourceId);
        return delay({ ok: true } as Awaited<ReturnType<AppRouterClient["project"]["database"]["deletePostgres"]>>);
      },
    },
    proxyRoute: {
      list: ({ projectId }: { projectId: string }) => delay([...(mockRoutesByProject[projectId] ?? [])]),
    },
  },
};

export const client = mockClient as unknown as AppRouterClient;

export const orpc = createTanstackQueryUtils(client);
