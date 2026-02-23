import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";
import { randomBytes } from "node:crypto";

const log = createLogger("domain:database-provisioner");

export type DatabaseType = "postgresql" | "redis" | "mysql" | "mongodb";

export interface DatabaseConfig {
  image: string;
  dataPath: string;
  healthCheck: string;
  defaultPort: number;
  envMapping: Record<string, string>;
  connectionStringTemplate: string;
}

export const DATABASE_CONFIGS: Record<DatabaseType, DatabaseConfig> = {
  postgresql: {
    image: "postgres:16",
    dataPath: "/var/lib/postgresql/data",
    healthCheck: "pg_isready -U $POSTGRES_USER",
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
    healthCheck: "redis-cli ping",
    defaultPort: 6379,
    envMapping: { password: "REDIS_PASSWORD" },
    connectionStringTemplate: "redis://:{password}@{host}:{port}",
  },
  mysql: {
    image: "mysql:8",
    dataPath: "/var/lib/mysql",
    healthCheck: "mysqladmin ping -u root -p$MYSQL_ROOT_PASSWORD",
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
    healthCheck: 'mongosh --eval "db.runCommand(\'ping\')"',
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

// Supported image versions for each database type
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

  return { user, password, database };
}

export function buildConnectionString(
  dbType: DatabaseType,
  credentials: Record<string, string>,
  host: string,
  port: number,
): string {
  let template = DATABASE_CONFIGS[dbType].connectionStringTemplate;
  template = template.replace("{user}", credentials.user || "");
  template = template.replace("{password}", credentials.password || "");
  template = template.replace("{host}", host);
  template = template.replace("{port}", String(port));
  template = template.replace("{database}", credentials.database || "");
  return template;
}

export function getServiceName(resourceId: string): string {
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
    const value = credentials[credKey];
    if (value) {
      env.push(`${envVar}=${value}`);
    }
  }

  return env;
}

// Dependencies interface for testability
export interface ProvisionDeps {
  createVolume: (
    name: string,
    labels: Record<string, string>,
  ) => Promise<Result<{ name: string }, Error>>;
  createService: (opts: any) => Promise<Result<string, Error>>;
  inspectService: (name: string) => Promise<Result<any, Error>>;
  updateService: (name: string, opts: any) => Promise<Result<void, Error>>;
  removeService: (name: string) => Promise<Result<void, Error>>;
  listContainers: (serviceFilter: string) => Promise<Result<any[], Error>>;
  scaleService: (
    name: string,
    replicas: number,
  ) => Promise<Result<void, Error>>;
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
    customConfig?: Record<string, unknown>;
    resourceLimits?: { cpuLimit?: number; memoryLimitMb?: number };
  },
  deps: ProvisionDeps,
): Promise<
  Result<
    {
      serviceName: string;
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
  const serviceName = getServiceName(input.resourceId);
  const volumeName = getVolumeName(input.resourceId);
  const credentials = generateCredentials(input.dbType);
  const port = config.defaultPort;

  log.info(
    { resourceId: input.resourceId, dbType: input.dbType, image },
    "Provisioning database",
  );

  // Step 1: Create volume
  const volumeResult = await deps.createVolume(volumeName, {
    "otterstack.resource.id": input.resourceId,
    "otterstack.project.id": input.projectId,
    "otterstack.managed": "true",
  });
  if (volumeResult.isErr()) {
    log.error({ err: volumeResult.error }, "Failed to create volume");
    return Result.err(volumeResult.error);
  }

  // Step 2: Build service spec
  const env = buildServiceEnv(input.dbType, credentials);
  const ports: Array<{ target: number; published?: number }> = [];
  if (input.externalPort) {
    ports.push({ target: port, published: input.externalPort });
  }

  // Step 3: Create Swarm service
  const createResult = await deps.createService({
    name: serviceName,
    image,
    env,
    ports: ports.length > 0 ? ports : undefined,
    volumes: [
      { source: volumeName, target: config.dataPath, type: "volume" },
    ],
    networks: [`otterstack-proj-${input.projectId}`],
    labels: {
      "otterstack.resource.id": input.resourceId,
      "otterstack.project.id": input.projectId,
      "otterstack.environment.id": input.environmentId,
      "otterstack.organization.id": input.organizationId,
      "otterstack.database.type": input.dbType,
    },
    healthCheck: {
      cmd: config.healthCheck,
      interval: 10,
      timeout: 5,
      retries: 5,
    },
    restartPolicy: "always",
    resourceLimits: input.resourceLimits,
    replicas: 1,
  });

  if (createResult.isErr()) {
    log.error(
      { err: createResult.error },
      "Failed to create database service",
    );
    return Result.err(createResult.error);
  }

  // Step 4: Wait for health check (poll for up to 120 seconds)
  const healthTimeout = 120_000;
  const pollInterval = 5_000;
  const startTime = Date.now();
  let healthy = false;

  while (Date.now() - startTime < healthTimeout) {
    const containers = await deps.listContainers(serviceName);
    if (containers.isOk()) {
      const running = containers.value.find((c) => c.state === "running");
      if (running) {
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

  // Step 5: Build connection string
  const host = serviceName; // Swarm DNS resolution within overlay network
  const connectionString = buildConnectionString(
    input.dbType,
    credentials,
    host,
    port,
  );

  log.info(
    { resourceId: input.resourceId, serviceName, healthy },
    "Database provisioned",
  );

  return Result.ok({
    serviceName,
    volumeName,
    credentials,
    connectionString,
    port,
  });
}

export async function upgradeDatabase(
  input: {
    resourceId: string;
    newImageTag: string;
    dbType: DatabaseType;
  },
  deps: ProvisionDeps,
): Promise<Result<void, Error>> {
  const serviceName = getServiceName(input.resourceId);

  log.info(
    { resourceId: input.resourceId, newImageTag: input.newImageTag },
    "Upgrading database version",
  );

  // Step 1: Scale to 0 (stop database)
  const scaleDownResult = await deps.scaleService(serviceName, 0);
  if (scaleDownResult.isErr()) return Result.err(scaleDownResult.error);

  await deps.sleep(5_000); // Allow graceful shutdown

  // Step 2: Update to new image
  const updateResult = await deps.updateService(serviceName, {
    image: input.newImageTag,
  });
  if (updateResult.isErr()) {
    // Attempt to restore original
    await deps.scaleService(serviceName, 1);
    return Result.err(updateResult.error);
  }

  // Step 3: Scale back up
  const scaleUpResult = await deps.scaleService(serviceName, 1);
  if (scaleUpResult.isErr()) return Result.err(scaleUpResult.error);

  // Step 4: Wait for health check
  const healthTimeout = 120_000;
  const pollInterval = 5_000;
  const startTime = Date.now();
  let healthy = false;

  while (Date.now() - startTime < healthTimeout) {
    const containers = await deps.listContainers(serviceName);
    if (containers.isOk()) {
      const running = containers.value.find((c) => c.state === "running");
      if (running) {
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
