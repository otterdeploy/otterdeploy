import { describe, it, expect, vi, afterEach } from "vitest";
import {
  generateCredentials,
  buildConnectionString,
  buildServiceEnv,
  getServiceName,
  getVolumeName,
  provisionDatabase,
  upgradeDatabase,
  DATABASE_CONFIGS,
  SUPPORTED_VERSIONS,
} from "../database-provisioner";
import { Result } from "better-result";

function createMockDeps() {
  return {
    createVolume: vi.fn().mockResolvedValue(Result.ok({ name: "vol" })),
    createService: vi.fn().mockResolvedValue(Result.ok("svc-id")),
    inspectService: vi.fn().mockResolvedValue(Result.ok({ id: "svc-id" })),
    updateService: vi.fn().mockResolvedValue(Result.ok(undefined)),
    removeService: vi.fn().mockResolvedValue(Result.ok(undefined)),
    listContainers: vi
      .fn()
      .mockResolvedValue(Result.ok([{ state: "running" }])),
    scaleService: vi.fn().mockResolvedValue(Result.ok(undefined)),
    sleep: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Creates a sleep mock that advances Date.now() by the given ms each call.
 * This is needed to prevent infinite loops in health check polling when
 * using fake timers or mocked sleep.
 */
function createTimeAdvancingSleep() {
  let currentTime = Date.now();
  const originalDateNow = Date.now;

  // Override Date.now to return our controlled time
  vi.spyOn(Date, "now").mockImplementation(() => currentTime);

  const sleep = vi.fn().mockImplementation(async (ms: number) => {
    currentTime += ms;
  });

  return { sleep, restore: () => vi.restoreAllMocks() };
}

describe("database-provisioner", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("generateCredentials", () => {
    it("generates credentials for postgresql", () => {
      const creds = generateCredentials("postgresql");
      expect(creds.user).toBeTruthy();
      expect(creds.password).toBeTruthy();
      expect(creds.database).toBeTruthy();
    });

    it("generates empty user/database for redis", () => {
      const creds = generateCredentials("redis");
      expect(creds.user).toBe("");
      expect(creds.password).toBeTruthy();
      expect(creds.database).toBe("");
    });
  });

  describe("buildConnectionString", () => {
    it("builds postgresql connection string", () => {
      const cs = buildConnectionString(
        "postgresql",
        { user: "u", password: "p", database: "d" },
        "host",
        5432,
      );
      expect(cs).toBe("postgresql://u:p@host:5432/d");
    });

    it("builds redis connection string", () => {
      const cs = buildConnectionString(
        "redis",
        { user: "", password: "p", database: "" },
        "host",
        6379,
      );
      expect(cs).toBe("redis://:p@host:6379");
    });

    it("builds mysql connection string", () => {
      const cs = buildConnectionString(
        "mysql",
        { user: "u", password: "p", database: "d" },
        "host",
        3306,
      );
      expect(cs).toBe("mysql://u:p@host:3306/d");
    });

    it("builds mongodb connection string", () => {
      const cs = buildConnectionString(
        "mongodb",
        { user: "u", password: "p", database: "d" },
        "host",
        27017,
      );
      expect(cs).toBe("mongodb://u:p@host:27017/d");
    });
  });

  describe("buildServiceEnv", () => {
    it("builds env vars for postgresql", () => {
      const env = buildServiceEnv("postgresql", {
        user: "u",
        password: "p",
        database: "d",
      });
      expect(env).toContain("POSTGRES_USER=u");
      expect(env).toContain("POSTGRES_PASSWORD=p");
      expect(env).toContain("POSTGRES_DB=d");
    });

    it("builds env vars for redis", () => {
      const env = buildServiceEnv("redis", {
        user: "",
        password: "p",
        database: "",
      });
      expect(env).toContain("REDIS_PASSWORD=p");
      expect(env).toHaveLength(1);
    });
  });

  describe("getServiceName / getVolumeName", () => {
    it("returns correct service name", () => {
      expect(getServiceName("abc123")).toBe("otterstack-abc123");
    });
    it("returns correct volume name", () => {
      expect(getVolumeName("abc123")).toBe("otterstack-abc123-data");
    });
  });

  describe("provisionDatabase", () => {
    it("provisions a postgresql database successfully", async () => {
      const deps = createMockDeps();
      const result = await provisionDatabase(
        {
          resourceId: "res-1",
          projectId: "proj-1",
          environmentId: "env-1",
          organizationId: "org-1",
          dbType: "postgresql",
        },
        deps,
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.serviceName).toBe("otterstack-res-1");
        expect(result.value.volumeName).toBe("otterstack-res-1-data");
        expect(result.value.connectionString).toContain("postgresql://");
        expect(result.value.port).toBe(5432);
      }
      expect(deps.createVolume).toHaveBeenCalledOnce();
      expect(deps.createService).toHaveBeenCalledOnce();
    });

    it("provisions redis with correct config", async () => {
      const deps = createMockDeps();
      const result = await provisionDatabase(
        {
          resourceId: "res-2",
          projectId: "proj-1",
          environmentId: "env-1",
          organizationId: "org-1",
          dbType: "redis",
        },
        deps,
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.connectionString).toContain("redis://");
        expect(result.value.port).toBe(6379);
      }
    });

    it("includes external port when specified", async () => {
      const deps = createMockDeps();
      await provisionDatabase(
        {
          resourceId: "res-3",
          projectId: "proj-1",
          environmentId: "env-1",
          organizationId: "org-1",
          dbType: "postgresql",
          externalPort: 15432,
        },
        deps,
      );

      const createCall = deps.createService.mock.calls[0][0];
      expect(createCall.ports).toEqual([{ target: 5432, published: 15432 }]);
    });

    it("uses custom image tag when provided", async () => {
      const deps = createMockDeps();
      await provisionDatabase(
        {
          resourceId: "res-4",
          projectId: "proj-1",
          environmentId: "env-1",
          organizationId: "org-1",
          dbType: "postgresql",
          imageTag: "postgres:15",
        },
        deps,
      );

      const createCall = deps.createService.mock.calls[0][0];
      expect(createCall.image).toBe("postgres:15");
    });

    it("returns error when volume creation fails", async () => {
      const deps = createMockDeps();
      deps.createVolume.mockResolvedValue(
        Result.err(new Error("Volume creation failed")),
      );

      const result = await provisionDatabase(
        {
          resourceId: "res-5",
          projectId: "proj-1",
          environmentId: "env-1",
          organizationId: "org-1",
          dbType: "postgresql",
        },
        deps,
      );

      expect(result.isErr()).toBe(true);
    });

    it("returns error when service creation fails", async () => {
      const deps = createMockDeps();
      deps.createService.mockResolvedValue(
        Result.err(new Error("Service creation failed")),
      );

      const result = await provisionDatabase(
        {
          resourceId: "res-6",
          projectId: "proj-1",
          environmentId: "env-1",
          organizationId: "org-1",
          dbType: "postgresql",
        },
        deps,
      );

      expect(result.isErr()).toBe(true);
    });
  });

  describe("upgradeDatabase", () => {
    it("upgrades database version successfully", async () => {
      const deps = createMockDeps();
      const result = await upgradeDatabase(
        {
          resourceId: "res-1",
          newImageTag: "postgres:17",
          dbType: "postgresql",
        },
        deps,
      );

      expect(result.isOk()).toBe(true);
      expect(deps.scaleService).toHaveBeenCalledWith("otterstack-res-1", 0);
      expect(deps.updateService).toHaveBeenCalledWith("otterstack-res-1", {
        image: "postgres:17",
      });
      expect(deps.scaleService).toHaveBeenCalledWith("otterstack-res-1", 1);
    });

    it("restores original scale on update failure", async () => {
      const deps = createMockDeps();
      deps.updateService.mockResolvedValue(
        Result.err(new Error("Update failed")),
      );

      const result = await upgradeDatabase(
        {
          resourceId: "res-1",
          newImageTag: "postgres:17",
          dbType: "postgresql",
        },
        deps,
      );

      expect(result.isErr()).toBe(true);
      // Should have tried to restore
      expect(deps.scaleService).toHaveBeenCalledWith("otterstack-res-1", 1);
    });

    it("returns error when health check fails after upgrade", async () => {
      const { sleep } = createTimeAdvancingSleep();
      const deps = createMockDeps();
      deps.listContainers.mockResolvedValue(Result.ok([])); // No running containers
      deps.sleep = sleep;

      const result = await upgradeDatabase(
        {
          resourceId: "res-1",
          newImageTag: "postgres:17",
          dbType: "postgresql",
        },
        deps,
      );

      expect(result.isErr()).toBe(true);
    });
  });

  describe("DATABASE_CONFIGS", () => {
    it("has configs for all four database types", () => {
      expect(DATABASE_CONFIGS.postgresql).toBeDefined();
      expect(DATABASE_CONFIGS.redis).toBeDefined();
      expect(DATABASE_CONFIGS.mysql).toBeDefined();
      expect(DATABASE_CONFIGS.mongodb).toBeDefined();
    });
  });

  describe("SUPPORTED_VERSIONS", () => {
    it("has versions for all four database types", () => {
      expect(SUPPORTED_VERSIONS.postgresql.length).toBeGreaterThan(0);
      expect(SUPPORTED_VERSIONS.redis.length).toBeGreaterThan(0);
      expect(SUPPORTED_VERSIONS.mysql.length).toBeGreaterThan(0);
      expect(SUPPORTED_VERSIONS.mongodb.length).toBeGreaterThan(0);
    });
  });
});
