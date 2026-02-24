import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";
import { randomBytes } from "node:crypto";

const log = createLogger("domain:database-provisioner");

export type DatabaseType = "postgresql" | "redis" | "mysql" | "mongodb";

export interface DatabaseConfig {
  image: string;
  dataPath: string;
  defaultPort: number;
  envMapping: Record<string, string>;
  connectionStringTemplate: string;
}

export const DATABASE_CONFIGS: Record<DatabaseType, DatabaseConfig> = {
  postgresql: {
    image: "postgres:16",
    dataPath: "/var/lib/postgresql/data",
    defaultPort: 5432,
    envMapping: {
      user: "POSTGRES_USER",
      password: "POSTGRES_PASSWORD",
      database: "POSTGRES_DB",
    },
    connectionStringTemplate:
      "postgresql://{user}:{password}@{host}:{port}/{database}",
  },
  redis: {
    image: "redis:7-alpine",
    dataPath: "/data",
    defaultPort: 6379,
    envMapping: { password: "REDIS_PASSWORD" },
    connectionStringTemplate: "redis://:{password}@{host}:{port}",
  },
  mysql: {
    image: "mysql:8",
    dataPath: "/var/lib/mysql",
    defaultPort: 3306,
    envMapping: {
      user: "MYSQL_USER",
      password: "MYSQL_PASSWORD",
      database: "MYSQL_DATABASE",
      rootPassword: "MYSQL_ROOT_PASSWORD",
    },
    connectionStringTemplate:
      "mysql://{user}:{password}@{host}:{port}/{database}",
  },
  mongodb: {
    image: "mongo:7",
    dataPath: "/data/db",
    defaultPort: 27017,
    envMapping: {
      user: "MONGO_INITDB_ROOT_USERNAME",
      password: "MONGO_INITDB_ROOT_PASSWORD",
      database: "MONGO_INITDB_DATABASE",
    },
    connectionStringTemplate:
      "mongodb://{user}:{password}@{host}:{port}/{database}",
  },
};

export const SUPPORTED_VERSIONS: Record<DatabaseType, string[]> = {
  postgresql: ["postgres:14", "postgres:15", "postgres:16", "postgres:17"],
  redis: ["redis:6-alpine", "redis:7-alpine"],
  mysql: ["mysql:8.0", "mysql:8.4", "mysql:9"],
  mongodb: ["mongo:6", "mongo:7", "mongo:8"],
};

export function generateCredentials(
  dbType: DatabaseType,
): Record<string, string> {
  const password = randomBytes(24).toString("base64url");
  const user =
    dbType === "redis" ? "" : `otterstack_${randomBytes(4).toString("hex")}`;
  const database =
    dbType === "redis" ? "" : `otterstack_${randomBytes(4).toString("hex")}`;

  if (dbType === "mysql") {
    const rootPassword = randomBytes(24).toString("base64url");
    return { user, password, database, rootPassword };
  }

  return { user, password, database };
}

function credVal(credentials: Record<string, string>, key: string): string {
  return credentials[key] ?? "";
}

export function buildConnectionString(
  dbType: DatabaseType,
  credentials: Record<string, string>,
  host: string,
  port: number,
): string {
  let template = DATABASE_CONFIGS[dbType].connectionStringTemplate;
  template = template.replace("{user}", credVal(credentials, "user"));
  template = template.replace("{password}", credVal(credentials, "password"));
  template = template.replace("{host}", host);
  template = template.replace("{port}", String(port));
  template = template.replace("{database}", credVal(credentials, "database"));
  return template;
}

export function getStackName(resourceId: string): string {
  return `otterstack-${resourceId}`;
}

export function getVolumeName(resourceId: string): string {
  return `otterstack-${resourceId}-data`;
}

export function buildServiceEnv(
  dbType: DatabaseType,
  credentials: Record<string, string>,
): string[] {
  const config = DATABASE_CONFIGS[dbType];
  const env: string[] = [];

  for (const [credKey, envVar] of Object.entries(config.envMapping)) {
    const value = credVal(credentials, credKey);
    if (value) {
      env.push(`${envVar}=${value}`);
    }
  }

  // PostgreSQL: add PGUSER for pg_isready compatibility
  const pgUser = credVal(credentials, "user");
  if (dbType === "postgresql" && pgUser) {
    env.push(`PGUSER=${pgUser}`);
  }

  return env;
}

function escapeYamlValue(val: string): string {
  return val.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function buildHealthCheckCmd(
  dbType: DatabaseType,
  credentials: Record<string, string>,
): string {
  switch (dbType) {
    case "postgresql":
      return `psql -U ${credVal(credentials, "user")} -d ${credVal(credentials, "database")} -c 'SELECT 1' || exit 1`;
    case "mysql":
      return `mysqladmin ping -h localhost -u root -p${credVal(credentials, "rootPassword")}`;
    case "mongodb":
      return `mongosh --eval "db.adminCommand('ping')" --quiet`;
    case "redis":
      return `redis-cli -a ${credVal(credentials, "password")} ping`;
  }
}

export function generateComposeFile(input: {
  image: string;
  dbType: DatabaseType;
  credentials: Record<string, string>;
  volumeName: string;
  networkName: string;
  labels: Record<string, string>;
  externalPort?: number;
  resourceLimits?: { cpuLimit?: number; memoryLimitMb?: number };
}): string {
  const config = DATABASE_CONFIGS[input.dbType];
  const env = buildServiceEnv(input.dbType, input.credentials);
  const healthCmd = buildHealthCheckCmd(input.dbType, input.credentials);

  const lines: string[] = [
    'version: "3.8"',
    "",
    "services:",
    "  db:",
    `    image: ${input.image}`,
  ];

  // Redis requires explicit command for auth + persistence
  if (input.dbType === "redis") {
    const pw = escapeYamlValue(credVal(input.credentials, "password"));
    lines.push(
      `    command: ["redis-server", "--requirepass", "${pw}", "--appendonly", "yes"]`,
    );
  }

  // Environment
  lines.push("    environment:");
  for (const e of env) {
    lines.push(`      - "${escapeYamlValue(e)}"`);
  }

  // Volumes
  lines.push("    volumes:");
  lines.push(`      - data:${config.dataPath}`);

  // Ports (only when external access is needed)
  if (input.externalPort) {
    lines.push("    ports:");
    lines.push(`      - target: ${config.defaultPort}`);
    lines.push(`        published: ${input.externalPort}`);
    lines.push("        mode: host");
  }

  // Networks
  lines.push("    networks:");
  lines.push("      - projectnet");

  // Healthcheck
  lines.push("    healthcheck:");
  lines.push(
    `      test: ["CMD-SHELL", "${escapeYamlValue(healthCmd)}"]`,
  );
  lines.push("      interval: 5s");
  lines.push("      timeout: 5s");
  lines.push("      retries: 10");
  lines.push("      start_period: 5s");

  // Deploy config (Swarm)
  lines.push("    deploy:");
  lines.push("      replicas: 1");
  lines.push("      restart_policy:");
  lines.push("        condition: any");
  lines.push("      update_config:");
  lines.push("        parallelism: 1");
  lines.push("        order: start-first");
  lines.push("        failure_action: rollback");

  if (input.resourceLimits) {
    lines.push("      resources:");
    lines.push("        limits:");
    if (input.resourceLimits.cpuLimit != null) {
      lines.push(`          cpus: "${input.resourceLimits.cpuLimit}"`);
    }
    if (input.resourceLimits.memoryLimitMb != null) {
      lines.push(
        `          memory: ${input.resourceLimits.memoryLimitMb}M`,
      );
    }
  }

  // Deploy labels
  lines.push("      labels:");
  for (const [k, v] of Object.entries(input.labels)) {
    lines.push(`        ${k}: "${escapeYamlValue(v)}"`);
  }

  // Top-level volumes
  lines.push("");
  lines.push("volumes:");
  lines.push("  data:");
  lines.push(`    name: ${input.volumeName}`);
  lines.push("    labels:");
  lines.push('      otterstack.managed: "true"');
  for (const [k, v] of Object.entries(input.labels)) {
    if (k.endsWith(".resource.id") || k.endsWith(".project.id")) {
      lines.push(`      ${k}: "${escapeYamlValue(v)}"`);
    }
  }

  // Top-level networks
  lines.push("");
  lines.push("networks:");
  lines.push("  projectnet:");
  lines.push("    external: true");
  lines.push(`    name: ${input.networkName}`);

  return lines.join("\n") + "\n";
}

// Dependencies interface for testability
export interface StackDeps {
  stackDeploy: (
    stackName: string,
    composeContent: string,
  ) => Promise<Result<void, Error>>;
  stackRemove: (
    stackName: string,
  ) => Promise<Result<void, Error>>;
  stackServices: (
    stackName: string,
  ) => Promise<Result<Array<{ name: string; replicas: string; image: string }>, Error>>;
  sleep: (ms: number) => Promise<void>;
}

export async function provisionDatabase(
  input: {
    resourceId: string;
    projectId: string;
    environmentId: string;
    organizationId: string;
    dbType: DatabaseType;
    imageTag?: string;
    externalPort?: number;
    resourceLimits?: { cpuLimit?: number; memoryLimitMb?: number };
  },
  deps: StackDeps,
): Promise<
  Result<
    {
      stackName: string;
      volumeName: string;
      credentials: Record<string, string>;
      connectionString: string;
      port: number;
    },
    Error
  >
> {
  const config = DATABASE_CONFIGS[input.dbType];
  const image = input.imageTag ?? config.image;
  const stackName = getStackName(input.resourceId);
  const volumeName = getVolumeName(input.resourceId);
  const credentials = generateCredentials(input.dbType);
  const port = config.defaultPort;
  const networkName = `otterstack-proj-${input.projectId}`;

  log.info(
    { resourceId: input.resourceId, dbType: input.dbType, image },
    "Provisioning database via stack deploy",
  );

  const labels: Record<string, string> = {
    "otterstack.resource.id": input.resourceId,
    "otterstack.project.id": input.projectId,
    "otterstack.environment.id": input.environmentId,
    "otterstack.organization.id": input.organizationId,
    "otterstack.database.type": input.dbType,
  };

  // Generate compose file
  const composeContent = generateComposeFile({
    image,
    dbType: input.dbType,
    credentials,
    volumeName,
    networkName,
    labels,
    externalPort: input.externalPort,
    resourceLimits: input.resourceLimits,
  });

  // Deploy stack
  const deployResult = await deps.stackDeploy(stackName, composeContent);
  if (deployResult.isErr()) {
    log.error(
      { err: deployResult.error },
      "Failed to deploy database stack",
    );
    return Result.err(deployResult.error);
  }

  // Wait for the service to become healthy (poll for up to 120 seconds)
  const healthTimeout = 120_000;
  const pollInterval = 5_000;
  const startTime = Date.now();
  let healthy = false;

  while (Date.now() - startTime < healthTimeout) {
    const services = await deps.stackServices(stackName);
    if (services.isOk()) {
      const dbService = services.value.find((s) => s.name.endsWith("_db"));
      if (dbService && dbService.replicas === "1/1") {
        healthy = true;
        break;
      }
    }
    await deps.sleep(pollInterval);
  }

  if (!healthy) {
    log.warn(
      { resourceId: input.resourceId },
      "Database health check timed out, service may still be starting",
    );
  }

  // Connection string uses the Swarm DNS name: <stackName>_db
  const host = `${stackName}_db`;
  const connectionString = buildConnectionString(
    input.dbType,
    credentials,
    host,
    port,
  );

  log.info(
    { resourceId: input.resourceId, stackName, healthy },
    "Database provisioned",
  );

  return Result.ok({
    stackName,
    volumeName,
    credentials,
    connectionString,
    port,
  });
}

export async function upgradeDatabase(
  input: {
    resourceId: string;
    projectId: string;
    environmentId: string;
    organizationId: string;
    newImageTag: string;
    dbType: DatabaseType;
    credentials: Record<string, string>;
    externalPort?: number;
    resourceLimits?: { cpuLimit?: number; memoryLimitMb?: number };
  },
  deps: StackDeps,
): Promise<Result<void, Error>> {
  const stackName = getStackName(input.resourceId);
  const volumeName = getVolumeName(input.resourceId);
  const networkName = `otterstack-proj-${input.projectId}`;

  log.info(
    { resourceId: input.resourceId, newImageTag: input.newImageTag },
    "Upgrading database version via stack redeploy",
  );

  const labels: Record<string, string> = {
    "otterstack.resource.id": input.resourceId,
    "otterstack.project.id": input.projectId,
    "otterstack.environment.id": input.environmentId,
    "otterstack.organization.id": input.organizationId,
    "otterstack.database.type": input.dbType,
  };

  // Regenerate compose file with new image
  const composeContent = generateComposeFile({
    image: input.newImageTag,
    dbType: input.dbType,
    credentials: input.credentials,
    volumeName,
    networkName,
    labels,
    externalPort: input.externalPort,
    resourceLimits: input.resourceLimits,
  });

  // Redeploy — docker stack deploy updates existing services in-place
  const deployResult = await deps.stackDeploy(stackName, composeContent);
  if (deployResult.isErr()) {
    log.error(
      { err: deployResult.error },
      "Failed to redeploy database stack for upgrade",
    );
    return Result.err(deployResult.error);
  }

  // Wait for healthy state
  const healthTimeout = 120_000;
  const pollInterval = 5_000;
  const startTime = Date.now();
  let healthy = false;

  while (Date.now() - startTime < healthTimeout) {
    const services = await deps.stackServices(stackName);
    if (services.isOk()) {
      const dbService = services.value.find((s) => s.name.endsWith("_db"));
      if (dbService && dbService.replicas === "1/1") {
        healthy = true;
        break;
      }
    }
    await deps.sleep(pollInterval);
  }

  if (!healthy) {
    log.error(
      { resourceId: input.resourceId },
      "Health check failed after upgrade",
    );
    return Result.err(
      new Error("Database health check failed after version upgrade"),
    );
  }

  log.info(
    { resourceId: input.resourceId, newImageTag: input.newImageTag },
    "Database upgraded successfully",
  );
  return Result.ok(undefined);
}
