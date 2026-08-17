import type { Id, IdPrefix } from "@otterdeploy/shared/id";

import { hasPrefix, ID_PREFIX } from "@otterdeploy/shared/id";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../routers/service/queries", () => ({
  resolveResourceForPreview: vi.fn(),
  getServiceRecord: vi.fn(),
  // The preview overlay reads this; default to "no overrides" so base env flows
  // through (clearAllMocks keeps the impl, only wiping call history).
  listPreviewServiceEnvVars: vi.fn(async () => []),
}));

vi.mock("../../routers/project/queries", () => ({
  getDatabaseResourceRecord: vi.fn(),
  getProjectRecord: vi.fn(),
  getEnvironmentById: vi.fn(),
  loadProjectEnvBag: vi.fn(),
}));

// Vault resolution: providers + fetch are mocked so no HTTP or DB runs;
// decryptForDomain becomes identity so fixture "ciphertexts" pass through.
vi.mock("../../routers/vault-provider/queries", () => ({
  listVaultProvidersByOrg: vi.fn(async () => []),
}));
vi.mock("../vault", () => ({
  getSecrets: vi.fn(),
}));
vi.mock("../crypto", () => ({
  decryptForDomain: vi.fn(async (blob: string) => blob),
}));

import {
  getDatabaseResourceRecord,
  getEnvironmentById,
  getProjectRecord,
  loadProjectEnvBag,
} from "../../routers/project/queries";
import { getServiceRecord, resolveResourceForPreview } from "../../routers/service/queries";
import { listVaultProvidersByOrg } from "../../routers/vault-provider/queries";
import { getSecrets } from "../vault";
import { resolveServiceEnv } from "./resolver";

/** Brand a fixture id after genuinely checking its prefix (legacy spellings
 *  included) instead of casting. Throws on a typo'd fixture. */
function idOf<P extends IdPrefix>(prefix: P, value: string): Id<P> {
  if (!hasPrefix(value, prefix)) throw new Error(`expected a "${prefix}" id, got "${value}"`);
  return value;
}

const PROJECT_ID = idOf(ID_PREFIX.project, "project_1");
const RESOURCE_ID = idOf(ID_PREFIX.resource, "resource_api");
const PROD_ENV = "env_prod";
const PREVIEW_ENV = idOf(ID_PREFIX.preview, "prev_pr1");

/** The vi.mock factories above replace every import with a vi.fn(); narrow via
 *  vitest's own runtime check instead of casting. */
function asMock(fn: unknown) {
  if (!vi.isMockFunction(fn)) throw new Error("expected a vi.fn() mock");
  return fn;
}

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
    asMock(getProjectRecord).mockResolvedValue({ environmentId: PROD_ENV });
    asMock(getEnvironmentById).mockResolvedValue({ baseEnvironmentId: null });
    asMock(loadProjectEnvBag).mockResolvedValue({});
  });

  it("resolves a Postgres reference end-to-end", async () => {
    asMock(getServiceRecord).mockResolvedValueOnce({
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

    asMock(resolveResourceForPreview).mockResolvedValueOnce(
      mockResource({ id: "resource_db", name: "db", type: "database" }),
    );

    asMock(getDatabaseResourceRecord).mockResolvedValueOnce(dbExports());

    const result = await resolveServiceEnv(PROJECT_ID, RESOURCE_ID);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.DATABASE_URL).toBe("postgres://appuser:secret@appdb.internal:5432/appdb");
  });

  it("substitutes multiple refs inside a single value", async () => {
    asMock(getServiceRecord).mockResolvedValueOnce({
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

    asMock(resolveResourceForPreview).mockResolvedValue(
      mockResource({ id: "resource_db", name: "db", type: "database" }),
    );

    asMock(getDatabaseResourceRecord).mockResolvedValue(dbExports());

    const result = await resolveServiceEnv(PROJECT_ID, RESOURCE_ID);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.URL).toBe("postgres://appuser:secret@appdb.internal/appdb");
  });

  it("returns RefMissingResourceError when the referenced name is not in the project", async () => {
    asMock(getServiceRecord).mockResolvedValueOnce({
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

    asMock(resolveResourceForPreview).mockResolvedValueOnce(undefined);

    const result = await resolveServiceEnv(PROJECT_ID, RESOURCE_ID);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error._tag).toBe("RefMissingResourceError");
  });

  it("returns RefUnknownVarError when the var isn't exported by the upstream", async () => {
    asMock(getServiceRecord).mockResolvedValueOnce({
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

    asMock(resolveResourceForPreview).mockResolvedValueOnce(
      mockResource({ id: "resource_db", name: "db", type: "database" }),
    );
    asMock(getDatabaseResourceRecord).mockResolvedValueOnce(dbExports());

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

    asMock(getServiceRecord).mockImplementation(async (_pid: string, rid: string) => {
      if (rid === "resource_api") return apiRecord;
      if (rid === "resource_web") return webRecord;
      return undefined;
    });

    asMock(resolveResourceForPreview).mockImplementation(
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
    asMock(getEnvironmentById).mockResolvedValue({ baseEnvironmentId: PROD_ENV });
    // Base (prod) carries a shared var; the preview overrides nothing.
    asMock(loadProjectEnvBag).mockImplementation(async (input: { environmentId: string }) =>
      input.environmentId === PROD_ENV ? { APP_NAME: "acme" } : {},
    );

    asMock(getServiceRecord).mockResolvedValueOnce({
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
    asMock(resolveResourceForPreview).mockImplementation(
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
    asMock(getDatabaseResourceRecord).mockResolvedValueOnce(
      dbExports("postgres://appuser:secret@db-pr1.internal:5432/appdb"),
    );

    const result = await resolveServiceEnv(PROJECT_ID, RESOURCE_ID, PREVIEW_ENV);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.DATABASE_URL).toBe("postgres://appuser:secret@db-pr1.internal:5432/appdb");
    expect(result.value.APP_NAME).toBe("acme"); // inherited from the base env
  });
});

// Same narrowing as `asMock` above; alias kept so this block reads locally.
const mockOf = asMock;

describe("resolveServiceEnv — vault references", () => {
  const serviceWithEnv = (env: Array<{ key: string; value: string }>) => ({
    resource: mockResource({ id: "resource_api", name: "api", type: "service" }),
    service: { resourceId: "resource_api", internalHostname: "api" },
    ports: [],
    env: env.map((e, i) => ({
      id: `v${i}`,
      serviceResourceId: "resource_api",
      ...e,
    })),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockOf(getProjectRecord).mockResolvedValue({
      environmentId: PROD_ENV,
      organizationId: "org_1",
    });
    mockOf(getEnvironmentById).mockResolvedValue({ baseEnvironmentId: null });
    mockOf(loadProjectEnvBag).mockResolvedValue({});
    mockOf(listVaultProvidersByOrg).mockResolvedValue([
      {
        name: "prod",
        kind: "hashicorp",
        configJson: { url: "https://vault.local:8200" },
        credentialCiphertext: "cipher-token",
      },
    ]);
  });

  it("resolves vault refs with ONE batched fetch per provider", async () => {
    mockOf(getServiceRecord).mockResolvedValueOnce(
      serviceWithEnv([
        { key: "DB_PASSWORD", value: "${{vault.prod.app/db:password}}" },
        { key: "DB_USER", value: "user=${{vault.prod.app/db:user}}" },
      ]),
    );
    mockOf(getSecrets).mockResolvedValue(
      new Map([
        ["app/db:password", "s3cr3t"],
        ["app/db:user", "svc"],
      ]),
    );

    const result = await resolveServiceEnv(PROJECT_ID, RESOURCE_ID);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.DB_PASSWORD).toBe("s3cr3t");
    expect(result.value.DB_USER).toBe("user=svc");

    // Both refs travel in a single provider call, with the decrypted
    // credential (identity-mocked decryptForDomain).
    expect(getSecrets).toHaveBeenCalledTimes(1);
    expect(mockOf(getSecrets).mock.calls[0]?.[0]).toMatchObject({
      name: "prod",
      kind: "hashicorp",
      credential: "cipher-token",
    });
    expect(mockOf(getSecrets).mock.calls[0]?.[1]).toEqual(["app/db:password", "app/db:user"]);
    // Provider rows load once for the whole resolve.
    expect(listVaultProvidersByOrg).toHaveBeenCalledTimes(1);
  });

  it("fails with VaultResolveError when the provider name is not configured", async () => {
    mockOf(getServiceRecord).mockResolvedValueOnce(
      serviceWithEnv([{ key: "X", value: "${{vault.ghost.some/key:field}}" }]),
    );

    const result = await resolveServiceEnv(PROJECT_ID, RESOURCE_ID);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error._tag).toBe("VaultResolveError");
    expect(result.error.message).toContain("ghost");
  });

  it("wraps a provider fetch failure in VaultResolveError", async () => {
    mockOf(getServiceRecord).mockResolvedValueOnce(
      serviceWithEnv([{ key: "X", value: "${{vault.prod.app/db:password}}" }]),
    );
    mockOf(getSecrets).mockRejectedValue(
      new Error('secret provider "prod": HTTP 403 from the provider API'),
    );

    const result = await resolveServiceEnv(PROJECT_ID, RESOURCE_ID);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error._tag).toBe("VaultResolveError");
    expect(result.error.message).toContain("HTTP 403");
  });

  it("fails when the provider returns no value for a requested ref", async () => {
    mockOf(getServiceRecord).mockResolvedValueOnce(
      serviceWithEnv([{ key: "X", value: "${{vault.prod.app/db:password}}" }]),
    );
    mockOf(getSecrets).mockResolvedValue(new Map());

    const result = await resolveServiceEnv(PROJECT_ID, RESOURCE_ID);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error._tag).toBe("VaultResolveError");
  });
});
