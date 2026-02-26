import { describe, it, expect, vi, afterEach } from "vitest";
import {
  generateCredentials,
  buildConnectionString,
  buildServiceEnv,
  buildHealthCheckCmd,
  getStackName,
  getProjectScopedStackName,
  getVolumeName,
  getDatabaseServiceName,
  getProjectScopedDatabaseServiceName,
  generateComposeFile,
  provisionDatabase,
  upgradeDatabase,
  DATABASE_CONFIGS,
  SUPPORTED_VERSIONS,
} from "../database-provisioner";
import { Result } from "better-result";

function stackServiceName(resourceId: string) {
  return `${getStackName("proj-1", "env-1")}_${getDatabaseServiceName(resourceId)}`;
}

function environmentScopedStackServiceName(
  projectSlug: string,
  environmentSlug: string,
  resourceId: string,
) {
  return `${getStackName(projectSlug, environmentSlug)}_${getDatabaseServiceName(resourceId)}`;
}

function projectScopedStackServiceName(projectId: string, resourceId: string) {
  return `${getProjectScopedStackName(projectId)}_${getProjectScopedDatabaseServiceName(resourceId)}`;
}

function createMockDeps() {
  return {
    stackDeploy: vi.fn().mockResolvedValue(Result.ok(undefined)),
    stackRemove: vi.fn().mockResolvedValue(Result.ok(undefined)),
    stackServices: vi
      .fn()
      .mockResolvedValue(
        Result.ok([{
          name: stackServiceName("res-1"),
          replicas: "1/1",
          image: "postgres:16",
        }]),
      ),
    sleep: vi.fn().mockResolvedValue(undefined),
  };
}

function createTimeAdvancingSleep() {
  let currentTime = Date.now();
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

    it("generates rootPassword for mysql", () => {
      const creds = generateCredentials("mysql");
      expect(creds.rootPassword).toBeTruthy();
      expect(creds.user).toBeTruthy();
      expect(creds.password).toBeTruthy();
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
    it("builds env vars for postgresql with PGUSER", () => {
      const env = buildServiceEnv("postgresql", {
        user: "u",
        password: "p",
        database: "d",
      });
      expect(env).toContain("POSTGRES_USER=u");
      expect(env).toContain("POSTGRES_PASSWORD=p");
      expect(env).toContain("POSTGRES_DB=d");
      expect(env).toContain("PGUSER=u");
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

    it("builds env vars for mysql with root password", () => {
      const env = buildServiceEnv("mysql", {
        user: "u",
        password: "p",
        database: "d",
        rootPassword: "rp",
      });
      expect(env).toContain("MYSQL_USER=u");
      expect(env).toContain("MYSQL_PASSWORD=p");
      expect(env).toContain("MYSQL_DATABASE=d");
      expect(env).toContain("MYSQL_ROOT_PASSWORD=rp");
    });
  });

  describe("buildHealthCheckCmd", () => {
    it("builds postgresql healthcheck", () => {
      const cmd = buildHealthCheckCmd("postgresql", { user: "u", database: "d" });
      expect(cmd).toBe("psql -U u -d d -c 'SELECT 1' || exit 1");
    });

    it("builds mysql healthcheck", () => {
      const cmd = buildHealthCheckCmd("mysql", { rootPassword: "rp" });
      expect(cmd).toBe("mysqladmin ping -h localhost -u root -prp");
    });

    it("builds redis healthcheck with password", () => {
      const cmd = buildHealthCheckCmd("redis", { password: "pw" });
      expect(cmd).toBe("redis-cli -a pw ping");
    });

    it("builds mongodb healthcheck", () => {
      const cmd = buildHealthCheckCmd("mongodb", {});
      expect(cmd).toContain("mongosh");
    });
  });

  describe("getStackName / getVolumeName / getDatabaseServiceName", () => {
    it("returns correct stack name from project/environment slugs", () => {
      expect(getStackName("Nextoral", "Production")).toBe("nextoral_production");
    });
    it("returns correct volume name", () => {
      expect(getVolumeName("abc123")).toBe("otterstack-abc123-data");
    });
    it("returns correct database service name from resource ID", () => {
      expect(getDatabaseServiceName("res-1")).toBe("db-res-1");
    });
  });

  describe("generateComposeFile", () => {
    it("generates valid compose YAML for postgresql", () => {
      const yaml = generateComposeFile({
        image: "postgres:16",
        dbType: "postgresql",
        serviceName: "db-res-1",
        credentials: { user: "u", password: "p", database: "d" },
        volumeName: "otterstack-res-1-data",
        networkName: "otterstack-proj-proj-1",
        labels: {
          "otterstack.resource.id": "res-1",
          "otterstack.project.id": "proj-1",
          "otterstack.environment.id": "env-1",
          "otterstack.organization.id": "org-1",
          "otterstack.database.type": "postgresql",
        },
      });

      expect(yaml).toContain('version: "3.8"');
      expect(yaml).toContain("image: postgres:16");
      expect(yaml).toContain("POSTGRES_USER=u");
      expect(yaml).toContain("POSTGRES_PASSWORD=p");
      expect(yaml).toContain("POSTGRES_DB=d");
      expect(yaml).toContain("PGUSER=u");
      expect(yaml).toContain("data-db-res-1:/var/lib/postgresql/data");
      expect(yaml).toContain("psql -U u -d d");
      expect(yaml).toContain("start_period: 5s");
      expect(yaml).toContain("replicas: 1");
      expect(yaml).toContain("condition: any");
      expect(yaml).toContain("order: start-first");
      expect(yaml).toContain("failure_action: rollback");
      expect(yaml).toContain("name: otterstack-res-1-data");
      expect(yaml).toContain("external: true");
      expect(yaml).toContain("name: otterstack-proj-proj-1");
    });

    it("generates redis compose with command for auth", () => {
      const yaml = generateComposeFile({
        image: "redis:7-alpine",
        dbType: "redis",
        serviceName: "db-res-2",
        credentials: { user: "", password: "secret", database: "" },
        volumeName: "otterstack-res-2-data",
        networkName: "otterstack-proj-proj-1",
        labels: {
          "otterstack.resource.id": "res-2",
          "otterstack.project.id": "proj-1",
          "otterstack.environment.id": "env-1",
          "otterstack.organization.id": "org-1",
          "otterstack.database.type": "redis",
        },
      });

      expect(yaml).toContain("redis-server");
      expect(yaml).toContain("--requirepass");
      expect(yaml).toContain("secret");
      expect(yaml).toContain("--appendonly");
      expect(yaml).toContain("data-db-res-2:/data");
    });

    it("includes external port when specified", () => {
      const yaml = generateComposeFile({
        image: "postgres:16",
        dbType: "postgresql",
        serviceName: "db-res-1",
        credentials: { user: "u", password: "p", database: "d" },
        volumeName: "vol",
        networkName: "net",
        labels: { "otterstack.resource.id": "res-1", "otterstack.project.id": "p1", "otterstack.environment.id": "e1", "otterstack.organization.id": "o1", "otterstack.database.type": "postgresql" },
        externalPort: 15432,
      });

      expect(yaml).toContain("published: 15432");
      expect(yaml).toContain("target: 5432");
      expect(yaml).toContain("mode: host");
    });

    it("includes resource limits when specified", () => {
      const yaml = generateComposeFile({
        image: "postgres:16",
        dbType: "postgresql",
        serviceName: "db-res-1",
        credentials: { user: "u", password: "p", database: "d" },
        volumeName: "vol",
        networkName: "net",
        labels: { "otterstack.resource.id": "res-1", "otterstack.project.id": "p1", "otterstack.environment.id": "e1", "otterstack.organization.id": "o1", "otterstack.database.type": "postgresql" },
        resourceLimits: { cpuLimit: 2, memoryLimitMb: 512 },
      });

      expect(yaml).toContain('cpus: "2"');
      expect(yaml).toContain("memory: 512M");
    });

    it("generates mysql compose with root password env", () => {
      const yaml = generateComposeFile({
        image: "mysql:8",
        dbType: "mysql",
        serviceName: "db-res-1",
        credentials: { user: "u", password: "p", database: "d", rootPassword: "rp" },
        volumeName: "vol",
        networkName: "net",
        labels: { "otterstack.resource.id": "res-1", "otterstack.project.id": "p1", "otterstack.environment.id": "e1", "otterstack.organization.id": "o1", "otterstack.database.type": "mysql" },
      });

      expect(yaml).toContain("MYSQL_ROOT_PASSWORD=rp");
      expect(yaml).toContain("MYSQL_USER=u");
      expect(yaml).toContain("MYSQL_DATABASE=d");
      expect(yaml).toContain("data-db-res-1:/var/lib/mysql");
    });

    it("generates mongodb compose", () => {
      const yaml = generateComposeFile({
        image: "mongo:7",
        dbType: "mongodb",
        serviceName: "db-res-1",
        credentials: { user: "u", password: "p", database: "d" },
        volumeName: "vol",
        networkName: "net",
        labels: { "otterstack.resource.id": "res-1", "otterstack.project.id": "p1", "otterstack.environment.id": "e1", "otterstack.organization.id": "o1", "otterstack.database.type": "mongodb" },
      });

      expect(yaml).toContain("MONGO_INITDB_ROOT_USERNAME=u");
      expect(yaml).toContain("MONGO_INITDB_ROOT_PASSWORD=p");
      expect(yaml).toContain("data-db-res-1:/data/db");
      expect(yaml).toContain("mongosh");
    });
  });

  describe("provisionDatabase", () => {
    it("provisions a postgresql database via stack deploy", async () => {
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
        expect(result.value.stackName).toBe("proj-1_env-1");
        expect(result.value.volumeName).toBe("otterstack-res-1-data");
        expect(result.value.connectionString).toContain("postgresql://");
        expect(result.value.connectionString).toContain(
          environmentScopedStackServiceName("proj-1", "env-1", "res-1"),
        );
        expect(result.value.port).toBe(5432);
      }
      expect(deps.stackDeploy).toHaveBeenCalledOnce();

      // Verify compose content was passed
      const composeContent = deps.stackDeploy.mock.calls[0]?.[1] ?? "";
      expect(composeContent).toContain("postgres:16");
      expect(composeContent).toContain("POSTGRES_USER=");
    });

    it("provisions redis with correct config", async () => {
      const deps = createMockDeps();
      deps.stackServices.mockResolvedValue(
        Result.ok([{
          name: environmentScopedStackServiceName("proj-1", "env-1", "res-2"),
          replicas: "1/1",
          image: "redis:7-alpine",
        }]),
      );

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

      const composeContent = deps.stackDeploy.mock.calls[0]?.[1] ?? "";
      expect(composeContent).toContain("redis-server");
      expect(composeContent).toContain("--requirepass");
    });

    it("uses custom image tag when provided", async () => {
      const deps = createMockDeps();
      deps.stackServices.mockResolvedValue(
        Result.ok([{
          name: environmentScopedStackServiceName("proj-1", "env-1", "res-4"),
          replicas: "1/1",
          image: "postgres:15",
        }]),
      );
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

      const composeContent = deps.stackDeploy.mock.calls[0]?.[1] ?? "";
      expect(composeContent).toContain("image: postgres:15");
    });

    it("returns error when stack deploy fails", async () => {
      const deps = createMockDeps();
      deps.stackDeploy.mockResolvedValue(
        Result.err(new Error("Stack deploy failed")),
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
  });

  describe("upgradeDatabase", () => {
    it("keeps project-scoped naming when upgrading a project-scoped database service", async () => {
      const deps = createMockDeps();
      deps.stackServices.mockImplementation(async (stackName: string) => {
        if (stackName === getProjectScopedStackName("proj-1")) {
          return Result.ok([{
            name: projectScopedStackServiceName("proj-1", "res-project"),
            replicas: "1/1",
            image: "postgres:16",
          }]);
        }
        return Result.ok([]);
      });

      const result = await upgradeDatabase(
        {
          resourceId: "res-project",
          projectId: "proj-1",
          environmentId: "env-1",
          organizationId: "org-1",
          newImageTag: "postgres:17",
          dbType: "postgresql",
          credentials: { user: "u", password: "p", database: "d" },
        },
        deps,
      );

      expect(result.isOk()).toBe(true);
      expect(deps.stackDeploy).toHaveBeenCalledWith(
        getProjectScopedStackName("proj-1"),
        expect.any(String),
      );
      const composeContent = deps.stackDeploy.mock.calls[0]?.[1] ?? "";
      expect(composeContent).toContain("\n  db-res-project:\n");
    });

    it("keeps legacy stack naming when upgrading a legacy database service", async () => {
      const deps = createMockDeps();
      deps.stackServices.mockResolvedValue(
        Result.ok([{ name: "otterstack-res-legacy_db", replicas: "1/1", image: "postgres:16" }]),
      );

      const result = await upgradeDatabase(
        {
          resourceId: "res-legacy",
          projectId: "proj-1",
          environmentId: "env-1",
          organizationId: "org-1",
          newImageTag: "postgres:17",
          dbType: "postgresql",
          credentials: { user: "u", password: "p", database: "d" },
        },
        deps,
      );

      expect(result.isOk()).toBe(true);
      expect(deps.stackDeploy).toHaveBeenCalledWith(
        "otterstack-res-legacy",
        expect.any(String),
      );
      const composeContent = deps.stackDeploy.mock.calls[0]?.[1] ?? "";
      expect(composeContent).toContain("\n  db:\n");
    });

    it("upgrades database version via stack redeploy", async () => {
      const deps = createMockDeps();
      const result = await upgradeDatabase(
        {
          resourceId: "res-1",
          projectId: "proj-1",
          environmentId: "env-1",
          organizationId: "org-1",
          newImageTag: "postgres:17",
          dbType: "postgresql",
          credentials: { user: "u", password: "p", database: "d" },
        },
        deps,
      );

      expect(result.isOk()).toBe(true);
      expect(deps.stackDeploy).toHaveBeenCalledOnce();

      const composeContent = deps.stackDeploy.mock.calls[0]?.[1] ?? "";
      expect(composeContent).toContain("image: postgres:17");
    });

    it("returns error when health check fails after upgrade", async () => {
      const { sleep } = createTimeAdvancingSleep();
      const deps = createMockDeps();
      deps.stackServices.mockResolvedValue(
        Result.ok([{
          name: environmentScopedStackServiceName("proj-1", "env-1", "res-1"),
          replicas: "0/1",
          image: "postgres:17",
        }]),
      );
      deps.sleep = sleep;

      const result = await upgradeDatabase(
        {
          resourceId: "res-1",
          projectId: "proj-1",
          environmentId: "env-1",
          organizationId: "org-1",
          newImageTag: "postgres:17",
          dbType: "postgresql",
          credentials: { user: "u", password: "p", database: "d" },
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
