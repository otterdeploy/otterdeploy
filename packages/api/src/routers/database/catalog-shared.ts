/**
 * Pure helpers for the org database catalog — aggregation logic plus the
 * per-engine stat-output parsers. Leaf module (only type imports) so the unit
 * tests exercise the honest-degradation logic without dragging in the
 * auth/db/docker import chain the collectors need.
 */
import type { ResourceId } from "@otterdeploy/shared/id";

// ── Aggregation ─────────────────────────────────────────────────────────────

/** Tag portion of an image ref ("postgres:17-alpine" → "17-alpine").
 *  Digest-pinned and untagged refs → null. Registry ports are not tags. */
export function versionFromImage(image: string): string | null {
  const withoutDigest = image.split("@")[0] ?? image;
  const lastSegment = withoutDigest.slice(withoutDigest.lastIndexOf("/") + 1);
  const colon = lastSegment.indexOf(":");
  if (colon === -1) return null;
  const tag = lastSegment.slice(colon + 1);
  return tag.length > 0 ? tag : null;
}

/** First (already newest-first) row per resource id. */
export function firstPerResource<T extends { resourceId: ResourceId }>(
  rows: readonly T[],
): Map<ResourceId, T> {
  const out = new Map<ResourceId, T>();
  for (const row of rows) {
    if (!out.has(row.resourceId)) out.set(row.resourceId, row);
  }
  return out;
}

export interface BackupFreshness {
  lastBackupAt: string | null;
  lastBackupStatus: string | null;
}

/**
 * Freshness from newest-first backup rows: `lastBackupAt` is the newest
 * SUCCEEDED run (what a restore could actually use), `lastBackupStatus` is the
 * newest attempt of any outcome — together they read as "fresh", "stale", or
 * "backups are broken".
 */
export function backupFreshnessPerResource(
  rows: ReadonlyArray<{
    resourceId: ResourceId;
    status: string;
    completedAt: Date | null;
    createdAt: Date;
  }>,
): Map<ResourceId, BackupFreshness> {
  const out = new Map<ResourceId, BackupFreshness>();
  for (const row of rows) {
    const entry = out.get(row.resourceId) ?? { lastBackupAt: null, lastBackupStatus: null };
    if (entry.lastBackupStatus === null) entry.lastBackupStatus = row.status;
    if (entry.lastBackupAt === null && row.status === "succeeded") {
      entry.lastBackupAt = (row.completedAt ?? row.createdAt).toISOString();
    }
    out.set(row.resourceId, entry);
  }
  return out;
}

// ── Stats shape ─────────────────────────────────────────────────────────────

export interface CatalogStats {
  sizeBytes: number | null;
  connections: number | null;
  maxConnections: number | null;
  serverVersion: string | null;
}

export const EMPTY_STATS: CatalogStats = {
  sizeBytes: null,
  connections: null,
  maxConnections: null,
  serverVersion: null,
};

/** Reject after `ms` — the probe itself keeps running (docker exec has no
 *  cancel), but the request stops waiting on it. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Strict numeric cell → number, anything else → null (never NaN; an empty
 *  string is "no value", not `Number("") === 0`). */
export function toFiniteNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

// ── Per-engine output parsers ───────────────────────────────────────────────

/** Map the single Postgres stats row (column-ordered: size, connections,
 *  max_connections, server_version) to the normalized shape. */
export function parsePostgresStatsRow(row: Array<string | null> | undefined): CatalogStats {
  if (!row) return EMPTY_STATS;
  return {
    sizeBytes: toFiniteNumber(row[0]),
    connections: toFiniteNumber(row[1]),
    maxConnections: toFiniteNumber(row[2]),
    // server_version can carry a distro suffix ("16.4 (Debian …)") — keep the
    // leading version token only.
    serverVersion: row[3] ? (row[3].split(" ")[0] ?? null) : null,
  };
}

/** Pull one `key:value` line out of a redis INFO payload. */
function infoField(info: string, key: string): string | null {
  const m = info.match(new RegExp(`^${key}:(.*)$`, "m"));
  return m?.[1]?.trim() || null;
}

/** used_memory / connected_clients / maxclients / redis_version from `INFO`. */
export function parseRedisInfoStats(info: string): CatalogStats {
  return {
    sizeBytes: toFiniteNumber(infoField(info, "used_memory")),
    connections: toFiniteNumber(infoField(info, "connected_clients")),
    maxConnections: toFiniteNumber(infoField(info, "maxclients")),
    serverVersion: infoField(info, "redis_version"),
  };
}

/** First data line of a `mysql --batch` result (line 0 is the header). */
export function batchDataCells(out: string): string[] | null {
  const lines = out.replace(/\n$/, "").split("\n");
  const data = lines[1];
  return data == null || data === "" ? null : data.split("\t");
}

/** sizeOut: `SELECT SUM(size), @@max_connections, VERSION()` batch output;
 *  threadsOut: `SHOW GLOBAL STATUS LIKE 'Threads_connected'` batch output. */
export function parseMariadbStats(sizeOut: string, threadsOut: string): CatalogStats {
  const size = batchDataCells(sizeOut);
  const threads = batchDataCells(threadsOut);
  return {
    sizeBytes: toFiniteNumber(size?.[0]),
    // SHOW STATUS rows are `Variable_name<TAB>Value`.
    connections: toFiniteNumber(threads?.[1]),
    maxConnections: toFiniteNumber(size?.[1]),
    serverVersion: size?.[2]?.trim() || null,
  };
}

export interface MongoStatsPayload {
  dataSize?: number | null;
  current?: number | null;
  available?: number | null;
  version?: string | null;
}

export function parseMongoStats(payload: MongoStatsPayload): CatalogStats {
  const current = toFiniteNumber(payload.current);
  const available = toFiniteNumber(payload.available);
  return {
    sizeBytes: toFiniteNumber(payload.dataSize),
    connections: current,
    // Mongo reports remaining headroom, not a cap — the cap is current + available.
    maxConnections: current != null && available != null ? current + available : null,
    serverVersion: payload.version?.trim() || null,
  };
}
