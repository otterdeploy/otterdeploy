/**
 * Org-wide database catalog schemas — the /$org/databases page's single read.
 * One item per database-kind resource across every project in the active org,
 * carrying identity (project, engine, endpoints), runtime status, last-backup
 * freshness, and a small per-engine live-stats block. Every stat is nullable:
 * an unreachable database (or an engine we can't cheaply interrogate) degrades
 * to `stats: null` / `runtimeStatus: "unreachable"` rather than fake numbers.
 * Split out of contract.ts to keep it under the file-length cap.
 */
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";
import * as z from "zod";

export const catalogEngineSchema = z.enum([
  "postgres",
  "redis",
  "mariadb",
  "mongodb",
  "clickhouse",
  "rabbitmq",
  "minio",
  "meilisearch",
]);

/**
 * Live stats, best-effort per engine:
 *   postgres — pg_database_size / pg_stat_activity count / max_connections
 *   redis    — INFO used_memory / connected_clients / maxclients
 *   mariadb  — information_schema size / Threads_connected / @@max_connections
 *   mongodb  — db.stats() dataSize / serverStatus().connections
 * Engines without a cheap probe (clickhouse, rabbitmq, minio, meilisearch)
 * always report null fields.
 */
export const catalogStatsSchema = z.object({
  /** Data size in bytes (used memory for redis). */
  sizeBytes: z.number().nullable(),
  connections: z.number().nullable(),
  maxConnections: z.number().nullable(),
  /** Live server version string (e.g. "17.2"), when the engine reports one. */
  serverVersion: z.string().nullable(),
});

export const catalogRuntimeStatusSchema = z.enum([
  "running",
  "starting",
  "stopped",
  "missing",
  "error",
  // The runtime couldn't be interrogated at all (docker down / inspect timed
  // out) — distinct from "missing", which is a confirmed absence.
  "unreachable",
]);

export const orgCatalogItemSchema = z.object({
  resourceId: zId(ID_PREFIX.resource),
  name: z.string(),
  projectId: zId(ID_PREFIX.project),
  projectName: z.string(),
  projectSlug: z.string(),
  engine: catalogEngineSchema,
  engineLabel: z.string(),
  /** Image the latest deployment ran (falls back to the engine's catalog
   *  default when the database has never deployed). */
  image: z.string(),
  /** Tag portion of `image` (e.g. "17-alpine"), null for untagged refs. */
  version: z.string().nullable(),
  status: z.enum(["draft", "valid", "invalid"]),
  runtimeStatus: catalogRuntimeStatusSchema,
  volumeName: z.string(),
  internalHostname: z.string(),
  internalPort: z.number(),
  internalConnectionString: z.string(),
  publicEnabled: z.boolean(),
  publicHostname: z.string().nullable(),
  /** Completion time of the newest SUCCEEDED database backup, ISO. */
  lastBackupAt: z.string().nullable(),
  /** Status of the newest backup attempt of any outcome (freshness honesty:
   *  "failed" here + an old lastBackupAt = backups are broken, not fresh). */
  lastBackupStatus: z.string().nullable(),
  /** Null when the database wasn't running or the probe failed/timed out. */
  stats: catalogStatsSchema.nullable(),
});

export const orgCatalogInput = z.object({}).optional();

export const orgCatalogResultSchema = z.object({
  databases: z.array(orgCatalogItemSchema),
});
