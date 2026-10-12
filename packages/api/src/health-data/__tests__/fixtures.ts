/**
 * Builders for the health data Postgres tests: normalized batches, the
 * partitions a test window needs, and the horizons reset to "nothing expired"
 * (the files share one database and run one after another).
 */
import type { OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { healthMeta, healthRebuildPending } from "@otterdeploy/db/schema/health-data";
import { sql } from "drizzle-orm";
import * as z from "zod";

import type { IngestBatch, IngestMarker, IngestRecord, SeriesIdentity } from "../ingest-model";

import { DAY, MINUTE, type ProbeState, STATE } from "../model";
import { ensurePartitions, PARTITIONS } from "../partitions";
import { rowsOf, zNum } from "../sql";

export async function prepareWindow(now: number): Promise<void> {
  for (const spec of PARTITIONS) {
    (await ensurePartitions(spec, now - 9 * DAY, now + 2 * DAY)).unwrap();
  }
  await db.update(healthMeta).set({ v: 0 });
  // Obligations another file left behind point at its own time window, whose
  // partitions may be gone by now: every file starts from an empty queue.
  await db.delete(healthRebuildPending);
}

export function probeSeries(
  organizationId: OrganizationId,
  check: string,
  sourceNodeId = "node-a",
  extra: { vantage?: string; checkRevision?: number } = {},
): SeriesIdentity {
  return {
    kind: "probe",
    organizationId,
    sourceNodeId,
    checkId: check,
    checkRevision: extra.checkRevision ?? 1,
    subjectId: "svc",
    generation: 1,
    attemptId: "a1",
    vantage: extra.vantage ?? "serving-path",
  };
}

export function metricSeries(
  organizationId: OrganizationId,
  dimensionSet: string,
  sourceNodeId = "node-a",
  subjectId = "host",
): SeriesIdentity {
  return {
    kind: "metric",
    organizationId,
    sourceNodeId,
    subjectId,
    generation: 1,
    attemptId: "a1",
    dimensionSet,
    schemaVersion: 1,
  };
}

export function probe(
  series: SeriesIdentity,
  t: number,
  state: ProbeState,
  extra: Partial<IngestRecord> = {},
): IngestRecord {
  const success = state === STATE.healthy || state === STATE.degraded;
  return {
    series,
    t,
    seq: t,
    state,
    uncMs: 0,
    ttlMs: 3 * MINUTE,
    latUs: success ? 20_000 : null,
    attUs: null,
    vals: null,
    probe: { round: t, outcome: success ? 0 : 1, cause: 0, detail: {} },
    ...extra,
  };
}

export function metric(series: SeriesIdentity, t: number, vals: (number | null)[]): IngestRecord {
  return {
    series,
    t,
    seq: t,
    state: STATE.healthy,
    uncMs: 0,
    ttlMs: MINUTE,
    latUs: null,
    attUs: null,
    vals,
    probe: null,
  };
}

export function batch(
  records: IngestRecord[],
  opts: {
    markers?: IngestMarker[];
    live?: boolean;
    sourceNodeId?: string;
    bootId?: string;
    batchId?: string;
  } = {},
): IngestBatch {
  return {
    source: {
      sourceNodeId: opts.sourceNodeId ?? "node-a",
      nodeEpoch: 1,
      bootId: opts.bootId ?? "boot-1",
    },
    batchId: opts.batchId ?? null,
    live: opts.live ?? false,
    records,
    markers: opts.markers ?? [],
  };
}

const countRow = z.object({ n: zNum });

/** `select count(*) as n ...` */
export async function countOf(query: ReturnType<typeof sql>): Promise<number> {
  return rowsOf(await db.execute(query), countRow)[0]?.n ?? 0;
}

/** Deterministic hash in [0, 1) for shuffles and random-looking fixtures. */
export function mix(...xs: number[]): number {
  let h = 0x9e3779b9;
  for (const x of xs) {
    h = Math.imul(h ^ (x & 0xffffffff), 0x85ebca6b);
    h = Math.imul(h ^ Math.floor(x / 0x1_0000_0000), 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 0x1_0000_0000;
}
