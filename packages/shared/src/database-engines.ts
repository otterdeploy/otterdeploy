/**
 * Shared catalog of database engines. Both server (swarm spec, conn-string
 * builder) and client (wizard tiles, variables panel labels) read from this
 * single source so adding an engine means editing exactly one record here
 * plus the swarm adapter under packages/api/src/swarm/database-engines/.
 *
 * The runtime-side env / healthcheck / spec helpers live alongside the
 * adapter — anything that's UI-facing or fixed metadata lives here.
 */

export type DatabaseEngine =
  | "postgres"
  | "redis"
  | "mariadb"
  | "mongodb"
  | "clickhouse"
  | "rabbitmq"
  | "minio"
  | "meilisearch";

export type DatabaseCategory =
  | "relational"
  | "document"
  | "key-value"
  | "analytical"
  | "search"
  | "message-queue"
  | "object-store";

export interface DatabaseEngineMeta {
  /** Display name used in wizards, headings, etc. */
  label: string;
  category: DatabaseCategory;
  /** Default port the container listens on inside the swarm network. */
  defaultPort: number;
  /** Image repo on docker hub. Versions append as `<image>:<tag>`. */
  dockerImage: string;
  /** Default tag we pin to when the operator picks "latest stable". The
   *  swarm spec uses this when no explicit version was chosen at create
   *  time. Newest LTS for relational engines; major + suffix for others. */
  defaultTag: string;
  /** Tags the wizard offers in the version dropdown. The default tag must
   *  appear in this list. */
  versions: ReadonlyArray<string>;
  /** Connection-string scheme (left of `://`). Used by the connection
   *  string builder in the engine adapter; also surfaced on the resource
   *  detail's Connection strings card. */
  scheme: string;
  /** Whether the engine has the concept of "a database name" inside the
   *  server (postgres / mariadb / mongo do; redis doesn't — its `db` is
   *  a numeric index 0–15 and we don't model that as a "name"). */
  hasDatabaseName: boolean;
  /** Auth model used in the swarm spec:
   *   - `env`         — user/password set via env vars (most engines)
   *   - `requirepass` — redis-style, command-line `--requirepass`
   */
  authStyle: "env" | "requirepass";
}

export const DATABASE_ENGINES = {
  postgres: {
    label: "PostgreSQL",
    category: "relational",
    defaultPort: 5432,
    dockerImage: "postgres",
    defaultTag: "17-alpine",
    versions: ["17-alpine", "16-alpine", "15-alpine", "14-alpine"] as const,
    scheme: "postgresql",
    hasDatabaseName: true,
    authStyle: "env",
  },
  redis: {
    label: "Redis",
    category: "key-value",
    defaultPort: 6379,
    dockerImage: "redis",
    defaultTag: "7-alpine",
    versions: ["7-alpine", "7.4-alpine", "7.2-alpine"] as const,
    scheme: "redis",
    hasDatabaseName: false,
    authStyle: "requirepass",
  },
  mariadb: {
    label: "MariaDB",
    category: "relational",
    defaultPort: 3306,
    dockerImage: "mariadb",
    defaultTag: "11.4",
    versions: ["11.4", "11.2", "10.11"] as const,
    scheme: "mariadb",
    hasDatabaseName: true,
    authStyle: "env",
  },
  mongodb: {
    label: "MongoDB",
    category: "document",
    defaultPort: 27017,
    dockerImage: "mongo",
    defaultTag: "7",
    versions: ["7", "6"] as const,
    scheme: "mongodb",
    hasDatabaseName: true,
    authStyle: "env",
  },
  clickhouse: {
    label: "ClickHouse",
    category: "analytical",
    // Native protocol port. ClickHouse also serves HTTP on 8123, but the
    // single-port resource model exposes one — the native port is the primary
    // client protocol; HTTP isn't separately reachable.
    defaultPort: 9000,
    dockerImage: "clickhouse/clickhouse-server",
    defaultTag: "24.8",
    versions: ["24.8", "24.3", "23.8"] as const,
    scheme: "clickhouse",
    hasDatabaseName: true,
    authStyle: "env",
  },
  rabbitmq: {
    label: "RabbitMQ",
    category: "message-queue",
    // AMQP port. The management UI (15672) is a SECOND service port the
    // single-port resource model can't expose yet — the broker is fully
    // usable over amqp without it.
    defaultPort: 5672,
    dockerImage: "rabbitmq",
    defaultTag: "3.13",
    versions: ["3.13", "3.12"] as const,
    scheme: "amqp",
    hasDatabaseName: false,
    authStyle: "env",
  },
  minio: {
    label: "MinIO",
    category: "object-store",
    // S3 API port. The web console (9001) is a SECOND port the single-port
    // model can't expose yet — object storage works over the S3 API alone.
    defaultPort: 9000,
    dockerImage: "minio/minio",
    // MinIO tags are `RELEASE.<date>`; `latest` avoids pinning a tag that may
    // not exist. Repin to a specific RELEASE.* when a target version is chosen.
    defaultTag: "latest",
    versions: ["latest"] as const,
    scheme: "http",
    hasDatabaseName: false,
    authStyle: "env",
  },
  meilisearch: {
    label: "Meilisearch",
    category: "search",
    defaultPort: 7700,
    dockerImage: "getmeili/meilisearch",
    defaultTag: "v1.10",
    versions: ["v1.10", "v1.9"] as const,
    scheme: "http",
    hasDatabaseName: false,
    authStyle: "env",
  },
} as const satisfies Record<DatabaseEngine, DatabaseEngineMeta>;

export function getDatabaseEngine(engine: DatabaseEngine): DatabaseEngineMeta {
  return DATABASE_ENGINES[engine];
}

export function listDatabaseEngines(): ReadonlyArray<{
  id: DatabaseEngine;
  meta: DatabaseEngineMeta;
}> {
  return (Object.keys(DATABASE_ENGINES) as DatabaseEngine[]).map((id) => ({
    id,
    meta: DATABASE_ENGINES[id],
  }));
}
