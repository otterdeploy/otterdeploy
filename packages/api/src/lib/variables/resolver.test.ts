import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../queries/service", () => ({
  getResourceByProjectAndName: vi.fn(),
  getServiceRecord: vi.fn(),
}));

vi.mock("../queries/postgres-resource", () => ({
  getDatabaseResourceRecord: vi.fn(),
}));

import { getDatabaseResourceRecord } from "../queries/postgres-resource";

import {
  getResourceByProjectAndName,
  getServiceRecord,
} from "../queries/service";
import { resolveServiceEnv } from "./resolver";

type Mock = ReturnType<typeof vi.fn>;

const mockResource = (overrides: Partial<{
  id: string;
  projectId: string;
  name: string;
  type: "database" | "service";
}> = {}) => ({
  id: "resource_a",
  projectId: "project_1",
  name: "db",
  type: "database" as const,
  status: "valid" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const dbExports = () => ({
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
    internalConnectionString: "postgres://appuser:secret@appdb.internal:5432/appdb",
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
  });

  it("resolves a Postgres reference end-to-end", async () => {
    (getServiceRecord as unknown as Mock)
      .mockResolvedValueOnce({
        resource: mockResource({ id: "resource_api", name: "api", type: "service" }),
        service: { resourceId: "resource_api", internalHostname: "api" },
        ports: [],
        env: [{ id: "v1", serviceResourceId: "resource_api", key: "DATABASE_URL", value: "${{db.DATABASE_URL}}" }],
      });

    (getResourceByProjectAndName as unknown as Mock).mockResolvedValueOnce(
      mockResource({ id: "resource_db", name: "db", type: "database" }),
    );

    (getDatabaseResourceRecord as unknown as Mock).mockResolvedValueOnce(
      dbExports(),
    );

    const result = await resolveServiceEnv("project_1", "resource_api");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.DATABASE_URL).toBe(
      "postgres://appuser:secret@appdb.internal:5432/appdb",
    );
  });

  it("substitutes multiple refs inside a single value", async () => {
    (getServiceRecord as unknown as Mock).mockResolvedValueOnce({
      resource: mockResource({ id: "resource_api", name: "api", type: "service" }),
      service: { resourceId: "resource_api", internalHostname: "api" },
      ports: [],
      env: [{
        id: "v1",
        serviceResourceId: "resource_api",
        key: "URL",
        value: "postgres://${{db.PGUSER}}:${{db.PGPASSWORD}}@${{db.PGHOST}}/${{db.PGDATABASE}}",
      }],
    });

    (getResourceByProjectAndName as unknown as Mock).mockResolvedValue(
      mockResource({ id: "resource_db", name: "db", type: "database" }),
    );

    (getDatabaseResourceRecord as unknown as Mock).mockResolvedValue(dbExports());

    const result = await resolveServiceEnv("project_1", "resource_api");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.URL).toBe("postgres://appuser:secret@appdb.internal/appdb");
  });

  it("returns missing_resource when the referenced name is not in the project", async () => {
    (getServiceRecord as unknown as Mock).mockResolvedValueOnce({
      resource: mockResource({ id: "resource_api", name: "api", type: "service" }),
      service: { resourceId: "resource_api", internalHostname: "api" },
      ports: [],
      env: [{ id: "v1", serviceResourceId: "resource_api", key: "X", value: "${{ghost.FOO}}" }],
    });

    (getResourceByProjectAndName as unknown as Mock).mockResolvedValueOnce(undefined);

    const result = await resolveServiceEnv("project_1", "resource_api");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("missing_resource");
  });

  it("returns unknown_var when the var isn't exported by the upstream", async () => {
    (getServiceRecord as unknown as Mock).mockResolvedValueOnce({
      resource: mockResource({ id: "resource_api", name: "api", type: "service" }),
      service: { resourceId: "resource_api", internalHostname: "api" },
      ports: [],
      env: [{ id: "v1", serviceResourceId: "resource_api", key: "X", value: "${{db.NONEXISTENT}}" }],
    });

    (getResourceByProjectAndName as unknown as Mock).mockResolvedValueOnce(
      mockResource({ id: "resource_db", name: "db", type: "database" }),
    );
    (getDatabaseResourceRecord as unknown as Mock).mockResolvedValueOnce(dbExports());

    const result = await resolveServiceEnv("project_1", "resource_api");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("unknown_var");
  });

  it("detects a cycle between two services", async () => {
    const apiRecord = {
      resource: mockResource({ id: "resource_api", name: "api", type: "service" }),
      service: { resourceId: "resource_api", internalHostname: "api" },
      ports: [{ id: "p1", serviceResourceId: "resource_api", containerPort: 80, protocol: "tcp", appProtocol: "http", isPrimary: true }],
      env: [{ id: "v1", serviceResourceId: "resource_api", key: "OTHER", value: "${{web.HOST}}" }],
    };
    const webRecord = {
      resource: mockResource({ id: "resource_web", name: "web", type: "service" }),
      service: { resourceId: "resource_web", internalHostname: "web" },
      ports: [{ id: "p2", serviceResourceId: "resource_web", containerPort: 80, protocol: "tcp", appProtocol: "http", isPrimary: true }],
      env: [{ id: "v2", serviceResourceId: "resource_web", key: "OTHER", value: "${{api.HOST}}" }],
    };

    (getServiceRecord as unknown as Mock).mockImplementation(async (_pid: string, rid: string) => {
      if (rid === "resource_api") return apiRecord;
      if (rid === "resource_web") return webRecord;
      return undefined;
    });

    (getResourceByProjectAndName as unknown as Mock).mockImplementation(async (_pid: string, name: string) => {
      if (name === "web") return mockResource({ id: "resource_web", name: "web", type: "service" });
      if (name === "api") return mockResource({ id: "resource_api", name: "api", type: "service" });
      return undefined;
    });

    const result = await resolveServiceEnv("project_1", "resource_api");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("cycle");
  });
});
