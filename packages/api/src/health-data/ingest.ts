/**
 * Ingest of one normalized batch (./ingest-model.ts): resolve
 * the boot and every series (bounded by quotas), screen records the receiver
 * must not accept (too far in the future), classify over-uncertain records as
 * diagnostic, then append everything in one transaction (./ingest-write.ts):
 * dedupe by full identity, reject and audit contradictions, append the
 * ledger and raw payloads, and record the rebuild obligations.
 *
 * Decoding a node's telemetry frame into a batch, and deciding whether a
 * replay batch may run now (live has priority), happen before this.
 */
import { db } from "@otterdeploy/db";
import { healthBatch, healthSeries } from "@otterdeploy/db/schema/health-data";
import { Result } from "better-result";
import { and, eq } from "drizzle-orm";

import type { WriteRow } from "./write-row";

import {
  digestOf,
  type IngestBatch,
  type IngestMarker,
  type IngestRecord,
  type SeriesIdentity,
} from "./ingest-model";
import { writeRows } from "./ingest-write";
import { KIND, MAX_AUTHORITATIVE_UNCERTAINTY_MS, MAX_FUTURE_MS, nowMs, STATE } from "./model";
import { type Quotas, SeriesRegistry } from "./series";
import { type HealthDbError, toDbError } from "./sql";

export interface IngestStats {
  accepted: number;
  duplicates: number;
  contradictions: number;
  tooOld: number;
  future: number;
  /** Clock uncertainty over the authoritative bound: stored, never evaluated. */
  diagnostic: number;
  quotaRejected: number;
  markers: number;
  /** The batch id was already ingested: nothing was done. */
  duplicateBatch: boolean;
}

const emptyStats = (): IngestStats => ({
  accepted: 0,
  duplicates: 0,
  contradictions: 0,
  tooOld: 0,
  future: 0,
  diagnostic: 0,
  quotaRejected: 0,
  markers: 0,
  duplicateBatch: false,
});

export class Ingestor {
  private readonly registry: SeriesRegistry;

  constructor(quotas?: Quotas) {
    this.registry = new SeriesRegistry(quotas);
  }

  /** Ingest one batch; `receivedAt` is receiver time (epoch ms). */
  async ingest(
    batch: IngestBatch,
    receivedAt = nowMs(),
  ): Promise<Result<IngestStats, HealthDbError>> {
    const stats = emptyStats();
    const seen = await batchSeen(batch);
    if (seen.isErr()) return Result.err(seen.error);
    if (seen.value) return Result.ok({ ...stats, duplicateBatch: true });
    const boot = await this.registry.boot(batch.source);
    if (boot.isErr()) return Result.err(boot.error);
    const rows: WriteRow[] = [];
    const refused = new Set<string>();
    for (const record of batch.records) {
      const sid = await this.seriesOf(record.series, refused);
      if (sid.isErr()) return Result.err(sid.error);
      if (sid.value === null) stats.quotaRejected++;
      else rows.push(recordRow(record, sid.value, boot.value));
    }
    for (const marker of batch.markers) {
      const targets = await this.markerTargets(marker, batch.source.sourceNodeId);
      if (targets.isErr()) return Result.err(targets.error);
      for (const sid of targets.value) rows.push(markerRow(marker, sid, boot.value));
      stats.markers += targets.value.length;
    }
    const accepted = rows.filter((r) => r.t <= receivedAt + MAX_FUTURE_MS);
    stats.future = rows.length - accepted.length;
    stats.diagnostic = accepted.filter((r) => r.kind === KIND.diagnostic).length;
    if (accepted.length === 0 && batch.batchId === null) return Result.ok(stats);
    const written = await writeRows(accepted, {
      live: batch.live,
      now: receivedAt,
      batch: batch.batchId === null ? null : { ...batch.source, batchId: batch.batchId },
    });
    if (written.isErr()) return Result.err(written.error);
    return Result.ok({ ...stats, ...written.value });
  }

  private async seriesOf(
    identity: SeriesIdentity,
    refused: Set<string>,
  ): Promise<Result<number | null, HealthDbError>> {
    const key = JSON.stringify(identity);
    if (refused.has(key)) return Result.ok(null);
    const r = await this.registry.resolve(identity);
    if (r.isOk() && r.value === null) refused.add(key);
    return r;
  }

  /** The existing series of the reporting node a marker cuts (markers never create series). */
  private async markerTargets(
    marker: IngestMarker,
    sourceNodeId: string,
  ): Promise<Result<number[], HealthDbError>> {
    const target = marker.target;
    if (target.kind === "series") {
      const r = await this.registry.find(target.identity);
      return r.map((id) => (id === null ? [] : [id]));
    }
    const where =
      target.kind === "check" || target.kind === "org-subject"
        ? [eq(healthSeries.organizationId, target.organizationId)]
        : [eq(healthSeries.sourceNodeId, sourceNodeId)];
    if (target.kind === "check") {
      where.push(eq(healthSeries.checkId, target.checkId));
      if (target.checkRevision !== null) {
        where.push(eq(healthSeries.checkRevision, target.checkRevision));
      }
    }
    if (target.kind === "org-subject") where.push(eq(healthSeries.subjectId, target.subjectId));
    if (target.kind === "subject") {
      where.push(eq(healthSeries.subjectId, target.subjectId));
      if (target.dimensionSet !== null) {
        where.push(eq(healthSeries.dimensionSet, target.dimensionSet));
      }
    }
    return Result.tryPromise({
      catch: toDbError,
      try: async () =>
        (
          await db
            .select({ id: healthSeries.id })
            .from(healthSeries)
            .where(and(...where))
            .$withCache(false)
        ).map((r) => r.id),
    });
  }
}

/** Whether this batch id was already ingested (a cheap pre-check; the write re-checks). */
function batchSeen(batch: IngestBatch): Promise<Result<boolean, HealthDbError>> {
  const batchId = batch.batchId;
  if (batchId === null) return Promise.resolve(Result.ok(false));
  return Result.tryPromise({
    catch: toDbError,
    try: async () =>
      (
        await db
          .select({ id: healthBatch.batchId })
          .from(healthBatch)
          .where(
            and(
              eq(healthBatch.sourceNodeId, batch.source.sourceNodeId),
              eq(healthBatch.batchId, batchId),
            ),
          )
          .$withCache(false)
      ).length > 0,
  });
}

function recordRow(r: IngestRecord, sid: number, boot: number): WriteRow {
  const diagnostic = r.uncMs > MAX_AUTHORITATIVE_UNCERTAINTY_MS;
  return {
    sid,
    t: r.t,
    boot,
    seq: r.seq,
    kind: diagnostic ? KIND.diagnostic : KIND.observation,
    state: r.state,
    unc: r.uncMs,
    ttl: r.ttlMs,
    lat: r.latUs,
    att: r.attUs,
    vals: r.vals,
    digest: digestOf([r.t, r.state, r.uncMs, r.ttlMs, r.latUs, r.attUs, r.vals, r.probe]),
    probe: r.probe,
  };
}

function markerRow(m: IngestMarker, sid: number, boot: number): WriteRow {
  return {
    sid,
    t: m.t,
    boot,
    seq: m.seq,
    kind: m.kind,
    state: STATE.unknown,
    unc: 0,
    ttl: 1,
    lat: null,
    att: null,
    vals: null,
    digest: digestOf([m.kind, m.t, m.seq, sid]),
    probe: null,
  };
}
