/**
 * Pure string / identifier helpers shared across the project handler split —
 * docker-name + slug sanitizers, per-engine swarm name builders, the public
 * connection-string formatter, and the unique-violation sniffer. Leaf module:
 * depends only on the DatabaseEngine type so it can be imported anywhere
 * without creating a cycle.
 */
import type { DatabaseEngine } from "@otterdeploy/shared/database-engines";

export function sanitizeProjectSlug(projectId: string): string {
  const value = projectId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return value.length > 0 ? value : "project";
}

export function sanitizeDatabaseName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized.length > 0 ? normalized : "database";
}

export function clampPostgresIdentifier(value: string): string {
  return value.slice(0, 63);
}

export function sanitizeDockerName(value: string) {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized.slice(0, 63) || "otterdeploy-postgres";
}

// Per-engine prefixes for the swarm service + volume names. `pg`/`pgdata`
// are kept for postgres so existing rows continue to resolve to the same
// docker objects after this change ships — non-postgres engines used to
// silently inherit those same postgres prefixes and ended up named
// `otterdeploy-pg-<project>-<redis-resource>`, which was nonsense.
// Resources created against the wrong-prefix names (any non-postgres
// engine deployed before this fix) need to be torn down and recreated to
// pick up the correct names — the swarm service is still under the old
// `pg` name and won't be located by the new lookup.
const ENGINE_SERVICE_PREFIX: Record<DatabaseEngine, string> = {
  postgres: "pg",
  mariadb: "mariadb",
  redis: "redis",
  mongodb: "mongo",
  clickhouse: "ch",
  rabbitmq: "rmq",
  minio: "minio",
  meilisearch: "meili",
};

const ENGINE_VOLUME_PREFIX: Record<DatabaseEngine, string> = {
  postgres: "pgdata",
  mariadb: "mariadbdata",
  redis: "redisdata",
  mongodb: "mongodata",
  clickhouse: "chdata",
  rabbitmq: "rmqdata",
  minio: "miniodata",
  meilisearch: "meilidata",
};

export function buildContainerName(input: {
  engine: DatabaseEngine;
  projectSlug: string;
  resourceName: string;
}) {
  return sanitizeDockerName(
    `otterdeploy-${ENGINE_SERVICE_PREFIX[input.engine]}-${sanitizeProjectSlug(input.projectSlug)}-${sanitizeDatabaseName(input.resourceName)}`,
  );
}

export function buildVolumeName(input: {
  engine: DatabaseEngine;
  projectSlug: string;
  resourceName: string;
}) {
  return sanitizeDockerName(
    `otterdeploy-${ENGINE_VOLUME_PREFIX[input.engine]}-${sanitizeProjectSlug(input.projectSlug)}-${sanitizeDatabaseName(input.resourceName)}`,
  );
}

export function buildConnectionString(input: {
  username: string;
  password: string;
  hostname: string;
  port?: number;
  databaseName: string;
  sslmode?: "require";
  sslnegotiation?: "direct";
}) {
  const hostPort = input.port ? `${input.hostname}:${input.port}` : input.hostname;
  const url = new URL(
    `postgresql://${encodeURIComponent(input.username)}:${encodeURIComponent(input.password)}@${hostPort}/${encodeURIComponent(input.databaseName)}`,
  );

  if (input.sslmode) {
    url.searchParams.set("sslmode", input.sslmode);
  }

  if (input.sslnegotiation) {
    url.searchParams.set("sslnegotiation", input.sslnegotiation);
  }

  return url.toString();
}

export function isUniqueViolation(error: unknown): boolean {
  // Drizzle wraps the driver error in a DrizzleQueryError, so the Postgres
  // `23505` code sits on `.cause` — walk the chain to find it.
  let e: unknown = error;
  for (let depth = 0; depth < 5 && e && typeof e === "object"; depth++) {
    if ((e as { code?: unknown }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
