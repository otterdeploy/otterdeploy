/**
 * Rollup worker. A pass claims the oldest pending rebuild obligations,
 * re-reads the retained ledger for every intersected base bucket (plus the
 * predecessor or anchor), rebuilds those buckets from scratch with the same
 * evaluator the tests use, rebuilds the hour/day parents from their children
 * in the same snapshot, and deletes exactly the obligations it claimed, all
 * in ONE repeatable-read transaction.
 *
 * The commit is the atomic version switch: a crash before it exposes only the
 * previous complete set. An ingest that commits during the build is not in
 * the snapshot and leaves its own obligation, so its range is rebuilt again by
 * a later pass. Two passes that overlap conflict on the rows they both write;
 * the loser gets a serialization failure and the pass is retried.
 *
 * Exported as functions only: nothing schedules them yet.
 */
import { db } from "@otterdeploy/db";
import { healthMeta, healthRebuildPending, healthSeries } from "@otterdeploy/db/schema/health-data";
import { healthMetricR10m, healthProbeR10m } from "@otterdeploy/db/schema/health-data-partitioned";
import { Result } from "better-result";
import { asc, eq, inArray, min, sql } from "drizzle-orm";
import * as z from "zod";

import { evaluateMetricBuckets, evaluateProbeBuckets } from "./evaluate";
import { digestOf } from "./ingest-model";
import { fetchLedger, type RebuildRequest } from "./ledger-read";
import { BASE_BUCKET_MS, ceilTo, floorTo, nowMs, SERIES_KIND, SKETCH_ALPHA } from "./model";
import { rebuildParents } from "./rollup-parents";
import { type MetricOut, type ProbeOut, upsertMetric, upsertProbe } from "./rollup-write";
import { type HealthDbError, intArray, isRetryable, rowsOf, toDbError, type Tx, zNum } from "./sql";

export interface PassStats {
  series: number;
  obligations: number;
  baseBuckets: number;
  changedBase: number;
  hours: number;
  days: number;
  /** Serialization conflicts retried. */
  retries: number;
}

export interface PassOptions {
  /** Most series one pass claims. */
  maxSeries?: number;
  /** Event time "now"; buckets past it are not built. */
  asOf?: number;
  /** Attempts on serialization conflict. */
  maxAttempts?: number;
  /** Test seam: runs once the pass has claimed (its snapshot is fixed), before it reads and writes. */
  duringBuild?: () => Promise<void>;
}

const pendingRow = z.object({ series_id: zNum, lo: zNum, hi: zNum, ids: z.array(zNum) });
const horizonRow = z.object({ v: zNum });

/** Claimed ranges clamped to [replay horizon, now + one bucket), aligned to base buckets. */
async function claim(tx: Tx, ids: readonly number[], asOf: number) {
  const [h] = rowsOf(
    await tx.execute(sql`select v from ${healthMeta} where k = 'horizon_ms'`),
    horizonRow,
  );
  const horizon = floorTo(h?.v ?? 0, BASE_BUCKET_MS);
  const ceiling = ceilTo(asOf + BASE_BUCKET_MS, BASE_BUCKET_MS);
  const pending = rowsOf(
    await tx.execute(sql`
      select series_id, min(lo) as lo, max(hi) as hi, array_agg(id) as ids from ${healthRebuildPending}
       where series_id = any(${intArray(ids)}::bigint[]) group by series_id`),
    pendingRow,
  );
  const ranges: RebuildRequest[] = pending
    .map((p) => ({
      seriesId: p.series_id,
      lo: Math.max(horizon, floorTo(p.lo, BASE_BUCKET_MS)),
      hi: Math.min(ceiling, ceilTo(p.hi, BASE_BUCKET_MS)),
    }))
    .filter((r) => r.hi > r.lo);
  return { ranges, claimed: pending.flatMap((p) => p.ids) };
}

async function build(
  tx: Tx,
  ranges: readonly RebuildRequest[],
  kinds: Map<number, number>,
  asOf: number,
) {
  const fetched = await fetchLedger(tx, ranges);
  const probes: ProbeOut[] = [];
  const metrics: MetricOut[] = [];
  for (const range of ranges) {
    const { records, highWater: hw } = fetched.get(range.seriesId) ?? { records: [], highWater: 0 };
    const dg = digestOf(
      records
        .map((r) => `${r.t}.${r.boot}.${r.seq}.${r.kind}`)
        .toSorted((a, b) => a.localeCompare(b)),
    );
    const s = range.seriesId;
    if (kinds.get(s) === SERIES_KIND.probe) {
      for (const b of evaluateProbeBuckets(
        records,
        range.lo,
        range.hi,
        BASE_BUCKET_MS,
        SKETCH_ALPHA,
      )) {
        probes.push({
          s,
          bucket: b.start,
          hw,
          dg,
          dur: [...b.durMs, ...b.maintMs],
          n: b.n,
          sketch: b.sketch.count() > 0 ? b.sketch.encode() : null,
          att: b.attemptSketch.count() > 0 ? b.attemptSketch.encode() : null,
        });
      }
    } else {
      for (const b of evaluateMetricBuckets(records, range.lo, range.hi, BASE_BUCKET_MS)) {
        metrics.push({
          s,
          bucket: b.start,
          hw,
          dg,
          n: b.n,
          cov: b.coverageMs,
          mean: b.mean,
          max: b.max,
          cnt: b.count,
        });
      }
    }
  }
  const changedBase =
    (await upsertProbe(tx, healthProbeR10m, probes, asOf)) +
    (await upsertMetric(tx, healthMetricR10m, metrics, asOf));
  const parents = await rebuildParents(
    tx,
    probes.map((r) => [r.s, r.bucket] as const),
    metrics.map((r) => [r.s, r.bucket] as const),
    asOf,
  );
  return { baseBuckets: probes.length + metrics.length, changedBase, ...parents };
}

function attempt(
  kinds: Map<number, number>,
  asOf: number,
  duringBuild: (() => Promise<void>) | undefined,
): Promise<Omit<PassStats, "retries">> {
  return db.transaction(
    async (tx) => {
      const { ranges, claimed } = await claim(tx, [...kinds.keys()], asOf);
      if (duringBuild) await duringBuild();
      const built = await build(tx, ranges, kinds, asOf);
      if (claimed.length > 0) {
        await tx.delete(healthRebuildPending).where(inArray(healthRebuildPending.id, claimed));
      }
      return { series: ranges.length, obligations: claimed.length, ...built };
    },
    { isolationLevel: "repeatable read" },
  );
}

/** One claim-rebuild-publish pass, retried on serialization conflict. */
export async function runRollupPass(
  options: PassOptions = {},
): Promise<Result<PassStats, HealthDbError>> {
  const opts = { maxSeries: 300, asOf: nowMs(), maxAttempts: 5, ...options };
  const oldest = await Result.tryPromise({
    catch: toDbError,
    try: () =>
      db
        .selectDistinct({
          id: healthRebuildPending.seriesId,
          kind: healthSeries.kind,
          first: healthRebuildPending.id,
        })
        .from(healthRebuildPending)
        .innerJoin(healthSeries, eq(healthSeries.id, healthRebuildPending.seriesId))
        .orderBy(asc(healthRebuildPending.id))
        .limit(opts.maxSeries * 8)
        .$withCache(false),
  });
  if (oldest.isErr()) return Result.err(oldest.error);
  const kinds = new Map<number, number>();
  for (const row of oldest.value) if (kinds.size < opts.maxSeries) kinds.set(row.id, row.kind);
  const empty = {
    series: 0,
    obligations: 0,
    baseBuckets: 0,
    changedBase: 0,
    hours: 0,
    days: 0,
    retries: 0,
  };
  if (kinds.size === 0) return Result.ok(empty);
  for (let retries = 0; ; retries++) {
    const r = await Result.tryPromise({
      catch: toDbError,
      try: () => attempt(kinds, opts.asOf, opts.duringBuild),
    });
    if (r.isOk()) return Result.ok({ ...r.value, retries });
    if (!isRetryable(r.error) || retries + 1 >= opts.maxAttempts) return Result.err(r.error);
  }
}

/** Age of the oldest pending obligation: the replay lane's rollup-lag input. */
export async function rollupLagMs(now = nowMs()): Promise<Result<number, HealthDbError>> {
  const r = await Result.tryPromise({
    catch: toDbError,
    try: () =>
      db
        .select({ oldest: min(healthRebuildPending.createdAt) })
        .from(healthRebuildPending)
        .$withCache(false),
  });
  return r.map((rows) => {
    const oldest = rows[0]?.oldest;
    return oldest === null || oldest === undefined ? 0 : Math.max(0, now - oldest);
  });
}
