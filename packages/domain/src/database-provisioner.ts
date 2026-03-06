import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const log = createLogger("domain:database-provisioner");
const DATABASE_COMPOSE_TEMPLATE_PATH = new URL(
  "./compose-templates/database.compose.yml",
  import.meta.url,
);

export type DatabaseType =
  | "postgresql"
  | "mysql"
  | "mariadb"
  | "mongodb"
  | "redis"
  | "keydb"
  | "dragonfly"
  | "clickhouse";

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
  mariadb: {
    image: "mariadb:11",
    dataPath: "/var/lib/mysql",
    defaultPort: 3306,
    envMapping: {
      user: "MARIADB_USER",
      password: "MARIADB_PASSWORD",
      database: "MARIADB_DATABASE",
      rootPassword: "MARIADB_ROOT_PASSWORD",
    },
    connectionStringTemplate:
      "mysql://{user}:{password}@{host}:{port}/{database}",
  },
  keydb: {
    image: "eqalpha/keydb:latest",
    dataPath: "/data",
    defaultPort: 6379,
    envMapping: { password: "KEYDB_PASSWORD" },
    connectionStringTemplate: "redis://:{password}@{host}:{port}",
  },
  dragonfly: {
    image: "docker.dragonflydb.io/dragonflydb/dragonfly:latest",
    dataPath: "/data",
    defaultPort: 6379,
    envMapping: { password: "DFLY_PASSWORD" },
    connectionStringTemplate: "redis://:{password}@{host}:{port}",
  },
  clickhouse: {
    image: "clickhouse/clickhouse-server:latest",
    dataPath: "/var/lib/clickhouse",
    defaultPort: 8123,
    envMapping: {
      user: "CLICKHOUSE_USER",
      password: "CLICKHOUSE_PASSWORD",
      database: "CLICKHOUSE_DB",
    },
    connectionStringTemplate:
      "clickhouse://{user}:{password}@{host}:{port}/{database}",
  },
};

export const SUPPORTED_VERSIONS: Record<DatabaseType, string[]> = {
  postgresql: ["postgres:14", "postgres:15", "postgres:16", "postgres:17"],
  mysql: ["mysql:8.0", "mysql:8.4", "mysql:9"],
  mariadb: ["mariadb:10.11", "mariadb:11"],
  mongodb: ["mongo:6", "mongo:7", "mongo:8"],
  redis: ["redis:6-alpine", "redis:7-alpine"],
  keydb: ["eqalpha/keydb:latest"],
  dragonfly: ["docker.dragonflydb.io/dragonflydb/dragonfly:latest"],
  clickhouse: ["clickhouse/clickhouse-server:latest", "clickhouse/clickhouse-server:24"],
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

function normalizeNamePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function getDatabaseComposeTemplate(): string {
  // Read on each call to avoid stale in-memory template when hot-reloading in dev.
  return readFileSync(DATABASE_COMPOSE_TEMPLATE_PATH, "utf-8");
}

function renderComposeTemplate(
  template: string,
  replacements: Record<string, string>,
): string {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_token, key: string) => {
    const value = replacements[key];
    if (value === undefined) {
      throw new Error(`Missing compose template replacement for ${key}`);
    }
    return value;
  });
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

export function getStackName(projectSlug: string, environmentSlug: string): string {
  return `${normalizeNamePart(projectSlug)}_${normalizeNamePart(environmentSlug)}`;
}

export function getProjectScopedStackName(projectId: string): string {
  return `otterstack-${normalizeNamePart(projectId)}`;
}

export function getResourceScopedStackName(resourceId: string): string {
  return `otterstack-${normalizeNamePart(resourceId)}`;
}

export function getVolumeName(resourceId: string): string {
  return `otterstack-${resourceId}-data`;
}

export function getDatabaseServiceName(resourceId: string): string {
  return `db-${normalizeNamePart(resourceId)}`;
}

export function getProjectScopedDatabaseServiceName(resourceId: string): string {
  return `db-${normalizeNamePart(resourceId)}`;
}

export function getResourceScopedDatabaseServiceName(_resourceId: string): string {
  return "db";
}

export function getNetworkName(projectId: string, environmentId: string): string {
  // Docker limits names to 63 characters; truncate IDs to first 8 chars
  return `otterstack-proj-${normalizeNamePart(projectId).slice(0, 8)}-env-${normalizeNamePart(environmentId).slice(0, 8)}`;
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
    case "mariadb":
      return `healthcheck.sh --connect --innodb_initialized`;
    case "keydb":
      return `keydb-cli -a ${credVal(credentials, "password")} ping`;
    case "dragonfly":
      return `redis-cli -a ${credVal(credentials, "password")} ping`;
    case "clickhouse":
      return `clickhouse-client --query "SELECT 1"`;
  }
}

export function generateComposeFile(input: {
  composeProjectName: string;
  image: string;
  dbType: DatabaseType;
  serviceName: string;
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
  const volumeKey = `data-${normalizeNamePart(input.serviceName)}`;

  const commandBlock = input.dbType === "redis"
    ? `    command: ["redis-server", "--requirepass", "${escapeYamlValue(credVal(input.credentials, "password"))}", "--appendonly", "yes"]\n`
    : "";

  const environmentBlock = env.map((e) => `      - "${escapeYamlValue(e)}"`).join("\n");

  const portsBlock = input.externalPort
    ? [
      "    ports:",
      `      - target: ${config.defaultPort}`,
      `        published: ${input.externalPort}`,
      "        mode: host",
      "",
    ].join("\n")
    : "";

  const resourceLimitsBlock = input.resourceLimits
    ? [
      "      resources:",
      "        limits:",
      ...(input.resourceLimits.cpuLimit != null
        ? [`          cpus: "${input.resourceLimits.cpuLimit}"`]
        : []),
      ...(input.resourceLimits.memoryLimitMb != null
        ? [`          memory: ${input.resourceLimits.memoryLimitMb}M`]
        : []),
      "",
    ].join("\n")
    : "";

  const deployLabelsBlock = Object.entries(input.labels)
    .map(([k, v]) => `        ${k}: "${escapeYamlValue(v)}"`)
    .join("\n");

  const volumeLabelsBlock = Object.entries(input.labels)
    .filter(([k]) => k.endsWith(".resource.id") || k.endsWith(".project.id"))
    .map(([k, v]) => `      ${k}: "${escapeYamlValue(v)}"`)
    .join("\n");

  const rendered = renderComposeTemplate(getDatabaseComposeTemplate(), {
    COMPOSE_PROJECT_NAME: input.composeProjectName,
    SERVICE_NAME: input.serviceName,
    IMAGE: input.image,
    COMMAND_BLOCK: commandBlock,
    ENVIRONMENT_BLOCK: `${environmentBlock}\n`,
    VOLUME_KEY: volumeKey,
    DATA_PATH: config.dataPath,
    PORTS_BLOCK: portsBlock,
    HEALTHCHECK_CMD: escapeYamlValue(healthCmd),
    RESOURCE_LIMITS_BLOCK: resourceLimitsBlock,
    DEPLOY_LABELS_BLOCK: deployLabelsBlock,
    VOLUME_NAME: input.volumeName,
    VOLUME_LABELS_BLOCK: volumeLabelsBlock ? `${volumeLabelsBlock}\n` : "",
    NETWORK_NAME: input.networkName,
  });

  // `docker stack deploy` rejects top-level Compose `name`.
  // Keep stack naming via CLI stack name and labels instead.
  const swarmSafe = rendered.replace(/^name:\s.*\n/m, "");

  return swarmSafe.endsWith("\n") ? swarmSafe : `${swarmSafe}\n`;
}

// Dependencies interface for testability
export interface StackDeps {
  stackDeploy: (
    stackName: string,
    composeContent: string,
    options?: { onLogLine?: (line: string, stream: "stdout" | "stderr") => void },
  ) => Promise<Result<void, Error>>;
  stackRemove: (
    stackName: string,
    options?: { onLogLine?: (line: string, stream: "stdout" | "stderr") => void },
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
    projectSlug?: string;
    environmentSlug?: string;
    organizationId: string;
    dbType: DatabaseType;
    imageTag?: string;
    externalPort?: number;
    resourceLimits?: { cpuLimit?: number; memoryLimitMb?: number };
    onLogLine?: (line: string, stream: "stdout" | "stderr") => void;
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
  const projectKey = input.projectSlug ?? input.projectId;
  const environmentKey = input.environmentSlug ?? input.environmentId;
  const stackName = getStackName(projectKey, environmentKey);
  const serviceName = getDatabaseServiceName(input.resourceId);
  const volumeName = getVolumeName(input.resourceId);
  const credentials = generateCredentials(input.dbType);
  const port = config.defaultPort;
  const networkName = getNetworkName(input.projectId, input.environmentId);

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
    composeProjectName: stackName,
    image,
    dbType: input.dbType,
    serviceName,
    credentials,
    volumeName,
    networkName,
    labels,
    externalPort: input.externalPort,
    resourceLimits: input.resourceLimits,
  });

  // Deploy stack
  const deployResult = await deps.stackDeploy(stackName, composeContent, {
    onLogLine: input.onLogLine,
  });
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
      const dbServiceName = `${stackName}_${serviceName}`;
      const dbService = services.value.find((s) => s.name === dbServiceName);
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

  // Swarm DNS host format: <stackName>_<serviceName>
  const host = `${stackName}_${serviceName}`;
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
    projectSlug?: string;
    environmentSlug?: string;
    organizationId: string;
    newImageTag: string;
    dbType: DatabaseType;
    credentials: Record<string, string>;
    externalPort?: number;
    resourceLimits?: { cpuLimit?: number; memoryLimitMb?: number };
    onLogLine?: (line: string, stream: "stdout" | "stderr") => void;
  },
  deps: StackDeps,
): Promise<Result<void, Error>> {
  const projectKey = input.projectSlug ?? input.projectId;
  const environmentKey = input.environmentSlug ?? input.environmentId;
  const environmentStackName = getStackName(projectKey, environmentKey);
  const environmentServiceName = getDatabaseServiceName(input.resourceId);
  const environmentStackServiceName = `${environmentStackName}_${environmentServiceName}`;

  const projectStackName = getProjectScopedStackName(input.projectId);
  const projectServiceName = getProjectScopedDatabaseServiceName(input.resourceId);
  const projectStackServiceName = `${projectStackName}_${projectServiceName}`;

  const resourceStackName = getResourceScopedStackName(input.resourceId);
  const resourceServiceName = getResourceScopedDatabaseServiceName(input.resourceId);
  const resourceStackServiceName = `${resourceStackName}_${resourceServiceName}`;

  // Backward compatibility:
  // 1) environment-scoped stack naming (current default)
  // 2) project-scoped stack naming used in recent deployments
  // 3) resource-scoped stack naming used historically
  const environmentServices = await deps.stackServices(environmentStackName);
  const usesEnvironmentScopedNaming =
    environmentServices.isOk() &&
    environmentServices.value.some((service) => service.name === environmentStackServiceName);

  const projectServices = await deps.stackServices(projectStackName);
  const usesProjectScopedNaming =
    projectServices.isOk() &&
    projectServices.value.some((service) => service.name === projectStackServiceName);

  const resourceServices = await deps.stackServices(resourceStackName);
  const usesResourceScopedNaming =
    resourceServices.isOk() &&
    resourceServices.value.some((service) => service.name === resourceStackServiceName);

  const stackName = usesEnvironmentScopedNaming
    ? environmentStackName
    : usesProjectScopedNaming
    ? projectStackName
    : resourceStackName;
  const serviceName = usesEnvironmentScopedNaming
    ? environmentServiceName
    : usesProjectScopedNaming
    ? projectServiceName
    : resourceServiceName;

  if (!usesEnvironmentScopedNaming && !usesProjectScopedNaming && !usesResourceScopedNaming) {
    log.info(
      { resourceId: input.resourceId, stackName, serviceName },
      "No existing stack naming found; using environment-scoped defaults",
    );
  }
  const volumeName = getVolumeName(input.resourceId);
  const networkName = getNetworkName(input.projectId, input.environmentId);

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
    composeProjectName: stackName,
    image: input.newImageTag,
    dbType: input.dbType,
    serviceName,
    credentials: input.credentials,
    volumeName,
    networkName,
    labels,
    externalPort: input.externalPort,
    resourceLimits: input.resourceLimits,
  });

  // Redeploy — docker stack deploy updates existing services in-place
  const deployResult = await deps.stackDeploy(stackName, composeContent, {
    onLogLine: input.onLogLine,
  });
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
      const dbServiceName = `${stackName}_${serviceName}`;
      const dbService = services.value.find((s) => s.name === dbServiceName);
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
