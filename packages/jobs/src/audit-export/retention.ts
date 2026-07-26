/**
 * Retention sweep for exported audit batches (od-5j8.21). Independent of the
 * DB's own 90-day `AUDIT_RETENTION_DAYS` purge (hourly-cleanup.ts) — the
 * whole point of exporting is to keep a copy that outlives the DB row, so
 * this window (`AUDIT_EXPORT_RETENTION_DAYS`, default 365) is normally much
 * longer. Only ever deletes objects under the export destination whose
 * batch key's own date path is older than the window; manifests are deleted
 * alongside their batch (same key stem).
 */
import type { AuditExportConfig } from "./config";

export interface RetentionResult {
  /** Batch (".ndjson") + manifest (".manifest.json") keys removed. */
  deleted: string[];
}

/** Parse the `YYYY/MM/DD` date path a batch key was written under (see
 *  export.ts `datePath`) back into a `Date` at that day's start (UTC). Keys
 *  that don't match the expected shape are left alone — never guess. */
function keyDate(key: string, keyPrefix: string): Date | null {
  if (!key.startsWith(keyPrefix)) return null;
  const rest = key.slice(keyPrefix.length);
  const match = /^(\d{4})\/(\d{2})\/(\d{2})\//.exec(rest);
  if (!match) return null;
  const [, y, m, d] = match;
  const iso = `${y}-${m}-${d}T00:00:00.000Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function runAuditExportRetention(config: AuditExportConfig): Promise<RetentionResult> {
  const cutoff = new Date(Date.now() - config.retentionDays * 24 * 60 * 60 * 1000);
  const keys = await config.destination.listKeys(config.keyPrefix);
  const deleted: string[] = [];
  for (const key of keys) {
    // Only judge batch keys by date — a manifest key (`....ndjson.manifest.json`)
    // shares its batch's date path, so filtering on `.ndjson` (not
    // `.manifest.json`) avoids double-counting while still deleting both
    // below once the batch is past the window.
    if (!key.endsWith(".ndjson")) continue;
    const d = keyDate(key, config.keyPrefix);
    if (!d || d >= cutoff) continue;
    await config.destination.deleteObject(key);
    deleted.push(key);
    const manifestKey = `${key}.manifest.json`;
    await config.destination.deleteObject(manifestKey);
    deleted.push(manifestKey);
  }
  return { deleted };
}
