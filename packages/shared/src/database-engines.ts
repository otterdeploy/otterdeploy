/**
 * Shared catalog of database engines. Both server (swarm spec, conn-string
 * builder) and client (wizard tiles, variables panel labels) read from this
 * single source so adding an engine means editing exactly one record here
 * plus the swarm adapter under packages/api/src/swarm/database-engines/.
 *
 * The runtime-side env / healthcheck / spec helpers live alongside the
 * adapter, anything that's UI-facing or fixed metadata lives here.
 */

export type DatabaseEngine = "postgres" | "redis" | "mariadb" | "mongodb" | "clickhouse";

export type DatabaseCategory = "relational" | "document" | "key-value" | "analytical";

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
   *  server (postgres / mariadb / mongo do; redis doesn't, its `db` is
   *  a numeric index 0–15 and we don't model that as a "name"). */
  hasDatabaseName: boolean;
  /** Auth model used in the swarm spec:
   *   - `env`: user/password set via env vars (most engines)
   *   - `requirepass`: redis-style, command-line `--requirepass`
   */
  authStyle: "env" | "requirepass";
  /** Where the data volume mounts inside the container. Version-aware
   *  engines override it per image: read it through `databaseDataMount`. */
  dataDir: string;
}

export const DATABASE_ENGINES = {
  postgres: {
    label: "PostgreSQL",
    category: "relational",
    defaultPort: 5432,
    dockerImage: "postgres",
    defaultTag: "18-alpine",
    versions: ["18-alpine", "17-alpine"] as const,
    scheme: "postgresql",
    hasDatabaseName: true,
    authStyle: "env",
    dataDir: "/var/lib/postgresql/data",
  },
  redis: {
    label: "Redis",
    category: "key-value",
    defaultPort: 6379,
    dockerImage: "redis",
    defaultTag: "8-alpine",
    versions: ["8-alpine", "7-alpine"] as const,
    scheme: "redis",
    hasDatabaseName: false,
    authStyle: "requirepass",
    dataDir: "/data",
  },
  mariadb: {
    label: "MariaDB",
    category: "relational",
    defaultPort: 3306,
    dockerImage: "mariadb",
    defaultTag: "12",
    versions: ["12", "11.4"] as const,
    scheme: "mariadb",
    hasDatabaseName: true,
    authStyle: "env",
    dataDir: "/var/lib/mysql",
  },
  mongodb: {
    label: "MongoDB",
    category: "document",
    defaultPort: 27017,
    dockerImage: "mongo",
    defaultTag: "8",
    versions: ["8", "7"] as const,
    scheme: "mongodb",
    hasDatabaseName: true,
    authStyle: "env",
    dataDir: "/data/db",
  },
  clickhouse: {
    label: "ClickHouse",
    category: "analytical",
    defaultPort: 9000,
    dockerImage: "clickhouse/clickhouse-server",
    defaultTag: "26.7-alpine",
    versions: ["26.7-alpine", "25.8-alpine"] as const,
    scheme: "clickhouse",
    hasDatabaseName: true,
    authStyle: "env",
    dataDir: "/var/lib/clickhouse",
  },
} as const satisfies Record<DatabaseEngine, DatabaseEngineMeta>;

/**
 * Where an engine's data volume mounts, for the image it will run. The
 * runtime mounts it here and the create wizard previews it from here, so the
 * two cannot disagree.
 *
 * postgres:18 moved PGDATA to a major-version subdir (/var/lib/postgresql/18/
 * docker) that its entrypoint creates and owns, and refuses to boot over a
 * volume mounted at the old .../data ("unused mount/volume"). From 18 on the
 * volume mounts the parent, /var/lib/postgresql, as upstream documents.
 */
export function databaseDataMount(engine: DatabaseEngine, image: string): string {
  if (engine === "postgres") {
    const name = image.split("@")[0]?.split("/").pop() ?? "";
    const tag = name.includes(":") ? name.slice(name.indexOf(":") + 1) : "";
    const major = /^(\d+)/.exec(tag)?.[1];
    if (major != null && Number(major) >= 18) return "/var/lib/postgresql";
  }
  return DATABASE_ENGINES[engine].dataDir;
}

export function getDatabaseEngine(engine: DatabaseEngine): DatabaseEngineMeta {
  return DATABASE_ENGINES[engine];
}

/** Real membership check against the catalog: what re-brands an `Object.keys`
 *  string (or any untrusted string) back into the `DatabaseEngine` union. */
export function isDatabaseEngine(value: string): value is DatabaseEngine {
  return value in DATABASE_ENGINES;
}

export function listDatabaseEngines(): ReadonlyArray<{
  id: DatabaseEngine;
  meta: DatabaseEngineMeta;
}> {
  return Object.keys(DATABASE_ENGINES)
    .filter(isDatabaseEngine)
    .map((id) => ({
      id,
      meta: DATABASE_ENGINES[id],
    }));
}
