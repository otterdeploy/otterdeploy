/**
 * Off-host audit export (od-5j8.21) — packages unexported `audit_log` rows
 * into an append-only NDJSON batch + a manifest, and writes both to the
 * configured destination (see ./config.ts). Rows are only marked
 * `exportedAt` after the destination write succeeds, so a destination
 * outage leaves them queued for the next run rather than silently dropped.
 *
 * "Append-only": batch keys are deterministic — a content-addressed id
 * range under a date path — so re-running an export that partially failed
 * (wrote the objects, crashed before marking rows) reproduces the SAME key
 * with the SAME bytes rather than a duplicate or a corrupted overwrite.
 * Nothing in this module ever calls `deleteObject` — only ./retention.ts
 * does, and only past the configured retention window.
 */
import type { AuditExportConfig } from "./config";

import { db } from "@otterdeploy/db";
import { auditLog } from "@otterdeploy/db/schema";
import { and, asc, inArray, isNull } from "drizzle-orm";

export interface ExportBatchResult {
  exported: number;
  key: string | null;
  manifestKey: string | null;
}

export interface AuditExportManifest {
  count: number;
  firstId: string;
  lastId: string;
  firstCreatedAt: string;
  lastCreatedAt: string;
  /** Chain hashes at the batch boundary (see packages/api/src/audit/chain.ts)
   *  — lets a verifier compare this exported tail against the live DB's
   *  chain state to catch a full-database rewrite that only touches rows
   *  written after the last export (see chain.ts's documented limitation). */
  firstHash: string | null;
  lastHash: string | null;
  exportedAt: string;
}

function datePath(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 4)}/${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
}

/** Export ONE batch (up to `batchSize` rows). Returns `exported: 0` when
 *  there is nothing left to export — the caller decides whether to loop. */
export async function runAuditExportBatch(
  config: AuditExportConfig,
  batchSize = 1000,
): Promise<ExportBatchResult> {
  const rows = await db
    .select()
    .from(auditLog)
    .where(and(isNull(auditLog.exportedAt)))
    .orderBy(asc(auditLog.createdAt), asc(auditLog.id))
    .limit(batchSize);

  if (rows.length === 0) return { exported: 0, key: null, manifestKey: null };

  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last) return { exported: 0, key: null, manifestKey: null };

  const ndjson = `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;
  const batchKey = `${config.keyPrefix}${datePath(first.createdAt)}/${first.id}_${last.id}.ndjson`;
  const manifestKey = `${batchKey}.manifest.json`;
  const manifest: AuditExportManifest = {
    count: rows.length,
    firstId: first.id,
    lastId: last.id,
    firstCreatedAt: first.createdAt.toISOString(),
    lastCreatedAt: last.createdAt.toISOString(),
    firstHash: first.hash,
    lastHash: last.hash,
    exportedAt: new Date().toISOString(),
  };

  await config.destination.putObject(batchKey, ndjson);
  await config.destination.putObject(manifestKey, JSON.stringify(manifest, null, 2));

  await db
    .update(auditLog)
    .set({ exportedAt: new Date() })
    .where(
      inArray(
        auditLog.id,
        rows.map((r) => r.id),
      ),
    );

  return { exported: rows.length, key: batchKey, manifestKey };
}

/** Drain the unexported backlog, one batch at a time, up to `maxBatches`
 *  (bounds one job run — a large backlog finishes over several cron ticks
 *  rather than one run holding the worker slot indefinitely). */
export async function runAuditExport(
  config: AuditExportConfig,
  opts?: { batchSize?: number; maxBatches?: number },
): Promise<{ totalExported: number; batches: ExportBatchResult[] }> {
  const batchSize = opts?.batchSize ?? 1000;
  const maxBatches = opts?.maxBatches ?? 20;
  const batches: ExportBatchResult[] = [];
  let totalExported = 0;
  for (let i = 0; i < maxBatches; i++) {
    const result = await runAuditExportBatch(config, batchSize);
    if (result.exported === 0) break;
    batches.push(result);
    totalExported += result.exported;
  }
  return { totalExported, batches };
}
