import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../routers/service/queries", () => ({
  resolveResourceForPreview: vi.fn(),
  getServiceRecord: vi.fn(),
}));

vi.mock("../../routers/project/queries", () => ({
  getDatabaseResourceRecord: vi.fn(),
  getProjectRecord: vi.fn(),
  getEnvironmentById: vi.fn(),
  loadProjectEnvBag: vi.fn(),
}));

import {
  getDatabaseResourceRecord,
  getEnvironmentById,
  getProjectRecord,
  loadProjectEnvBag,
} from "../../routers/project/queries";
import { getServiceRecord, resolveResourceForPreview } from "../../routers/service/queries";
import { resolveServiceEnv } from "./resolver";
const PROJECT_ID = "project_1" as ProjectId;
const RESOURCE_ID = "resource_api" as ResourceId;
const PROD_ENV = "env_prod";
const PREVIEW_ENV = "env_pr1";

type Mock = ReturnType<typeof vi.fn>;

const mockResource = (
  overrides: Partial<{
    id: string;
    projectId: string;
    name: string;
    type: "database" | "service";
    environmentId: string | null;
  }> = {},
) => ({
  id: "resource_a",
  projectId: "project_1",
  name: "db",
  type: "database" as const,
  status: "valid" as const,
  environmentId: null,
  branchedFromResourceId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const dbExports = (connString = "postgres://appuser:secret@appdb.internal:5432/appdb") => ({
  resource: mockResource({ id: "resource_db", name: "db", type: "database" }),
  database: {
    resourceId: "resource_db",
    engine: "postgres" as const,
    databaseName: "appdb",
    username: "appuser",
    password: "secret",
    publicHostname: "x.public",
    publicPort: 443,
    publicConnectionString: "postgres://public",
    internalHostname: "appdb.internal",
    internalPort: 5432,
    internalConnectionString: connString,
    upstreamHost: "appdb.internal",
    upstreamPort: 5432,
    caddyLayer4Snippet: "",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
});

describe("resolveServiceEnv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default (non-preview) call path: no explicit env → resolve the project's
    // persistent env, which has no base to inherit from.
    (getProjectRecord as unknown as Mock).mockResolvedValue({ environmentId: PROD_ENV });
    (getEnvironmentById as unknown as Mock).mockResolvedValue({ baseEnvironmentId: null });
    (loadProjectEnvBag as unknown as Mock).mockResolvedValue({});
  });

  it("resolves a Postgres reference end-to-end", async () => {
    (getServiceRecord as unknown as Mock).mockResolvedValueOnce({
      resource: mockResource({ id: "resource_api", name: "api", type: "service" }),
      service: { resourceId: "resource_api", internalHostname: "api" },
      ports: [],
      env: [
        {
          id: "v1",
          serviceResourceId: "resource_api",
          key: "DATABASE_URL",
          value: "${{db.DATABASE_URL}}",
        },
      ],
    });

    (resolveResourceForPreview as unknown as Mock).mockResolvedValueOnce(
      mockResource({ id: "resource_db", name: "db", type: "database" }),
    );

    (getDatabaseResourceRecord as unknown as Mock).mockResolvedValueOnce(dbExports());

    const result = await resolveServiceEnv(PROJECT_ID, RESOURCE_ID);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.DATABASE_URL).toBe("postgres://appuser:secret@appdb.internal:5432/appdb");
  });

  it("substitutes multiple refs inside a single value", async () => {
    (getServiceRecord as unknown as Mock).mockResolvedValueOnce({
      resource: mockResource({ id: "resource_api", name: "api", type: "service" }),
      service: { resourceId: "resource_api", internalHostname: "api" },
      ports: [],
      env: [
        {
          id: "v1",
          serviceResourceId: "resource_api",
          key: "URL",
          value: "postgres://${{db.PGUSER}}:${{db.PGPASSWORD}}@${{db.PGHOST}}/${{db.PGDATABASE}}",
        },
      ],
    });

    (resolveResourceForPreview as unknown as Mock).mockResolvedValue(
      mockResource({ id: "resource_db", name: "db", type: "database" }),
    );

    (getDatabaseResourceRecord as unknown as Mock).mockResolvedValue(dbExports());

    const result = await resolveServiceEnv(PROJECT_ID, RESOURCE_ID);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.URL).toBe("postgres://appuser:secret@appdb.internal/appdb");
  });

  it("returns RefMissingResourceError when the referenced name is not in the project", async () => {
    (getServiceRecord as unknown as Mock).mockResolvedValueOnce({
      resource: mockResource({ id: "resource_api", name: "api", type: "service" }),
      service: { resourceId: "resource_api", internalHostname: "api" },
      ports: [],
      env: [
        {
          id: "v1",
          serviceResourceId: "resource_api",
          key: "X",
          value: "${{ghost.FOO}}",
        },
      ],
    });

    (resolveResourceForPreview as unknown as Mock).mockResolvedValueOnce(undefined);

    const result = await resolveServiceEnv(PROJECT_ID, RESOURCE_ID);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error._tag).toBe("RefMissingResourceError");
  });

  it("returns RefUnknownVarError when the var isn't exported by the upstream", async () => {
    (getServiceRecord as unknown as Mock).mockResolvedValueOnce({
      resource: mockResource({ id: "resource_api", name: "api", type: "service" }),
      service: { resourceId: "resource_api", internalHostname: "api" },
      ports: [],
      env: [
        {
          id: "v1",
          serviceResourceId: "resource_api",
          key: "X",
          value: "${{db.NONEXISTENT}}",
        },
      ],
    });

    (resolveResourceForPreview as unknown as Mock).mockResolvedValueOnce(
      mockResource({ id: "resource_db", name: "db", type: "database" }),
    );
    (getDatabaseResourceRecord as unknown as Mock).mockResolvedValueOnce(dbExports());

    const result = await resolveServiceEnv(PROJECT_ID, RESOURCE_ID);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error._tag).toBe("RefUnknownVarError");
  });

  it("detects a cycle between two services", async () => {
    const apiRecord = {
      resource: mockResource({ id: "resource_api", name: "api", type: "service" }),
      service: { resourceId: "resource_api", internalHostname: "api" },
      ports: [
        {
          id: "p1",
          serviceResourceId: "resource_api",
          containerPort: 80,
          protocol: "tcp",
          appProtocol: "http",
          isPrimary: true,
        },
      ],
      env: [
        {
          id: "v1",
          serviceResourceId: "resource_api",
          key: "OTHER",
          value: "${{web.HOST}}",
        },
      ],
    };
    const webRecord = {
      resource: mockResource({ id: "resource_web", name: "web", type: "service" }),
      service: { resourceId: "resource_web", internalHostname: "web" },
      ports: [
        {
          id: "p2",
          serviceResourceId: "resource_web",
          containerPort: 80,
          protocol: "tcp",
          appProtocol: "http",
          isPrimary: true,
        },
      ],
      env: [
        {
          id: "v2",
          serviceResourceId: "resource_web",
          key: "OTHER",
          value: "${{api.HOST}}",
        },
      ],
    };

    (getServiceRecord as unknown as Mock).mockImplementation(async (_pid: string, rid: string) => {
      if (rid === "resource_api") return apiRecord;
      if (rid === "resource_web") return webRecord;
      return undefined;
    });

    (resolveResourceForPreview as unknown as Mock).mockImplementation(
      async (_pid: string, _envId: string, name: string) => {
        if (name === "web")
          return mockResource({ id: "resource_web", name: "web", type: "service" });
        if (name === "api")
          return mockResource({ id: "resource_api", name: "api", type: "service" });
        return undefined;
      },
    );

    const result = await resolveServiceEnv(PROJECT_ID, RESOURCE_ID);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error._tag).toBe("RefCycleError");
  });

  it("resolves in a preview env: env-specific DB branch + inherited base project var", async () => {
    // Preview env inherits from production.
    (getEnvironmentById as unknown as Mock).mockResolvedValue({ baseEnvironmentId: PROD_ENV });
    // Base (prod) carries a shared var; the preview overrides nothing.
    (loadProjectEnvBag as unknown as Mock).mockImplementation(
      async (input: { environmentId: string }) =>
        input.environmentId === PROD_ENV ? { APP_NAME: "acme" } : {},
    );

    (getServiceRecord as unknown as Mock).mockResolvedValueOnce({
      resource: mockResource({ id: "resource_api", name: "api", type: "service" }),
      service: { resourceId: "resource_api", internalHostname: "api" },
      ports: [],
      env: [
        {
          id: "v1",
          serviceResourceId: "resource_api",
          key: "DATABASE_URL",
          value: "${{db.DATABASE_URL}}",
        },
        {
          id: "v2",
          serviceResourceId: "resource_api",
          key: "APP_NAME",
          value: "${{project.APP_NAME}}",
        },
      ],
    });

    // The env-aware lookup returns the branch DB (env-specific) for this preview.
    (resolveResourceForPreview as unknown as Mock).mockImplementation(
      async (_pid: string, envId: string, name: string) => {
        expect(envId).toBe(PREVIEW_ENV);
        if (name === "db")
          return mockResource({
            id: "resource_db_branch",
            name: "db",
            type: "database",
            environmentId: PREVIEW_ENV,
          });
        return undefined;
      },
    );
    (getDatabaseResourceRecord as unknown as Mock).mockResolvedValueOnce(
      dbExports("postgres://appuser:secret@db-pr1.internal:5432/appdb"),
    );

    const result = await resolveServiceEnv(PROJECT_ID, RESOURCE_ID, PREVIEW_ENV as never);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.DATABASE_URL).toBe("postgres://appuser:secret@db-pr1.internal:5432/appdb");
    expect(result.value.APP_NAME).toBe("acme"); // inherited from the base env
  });
});
