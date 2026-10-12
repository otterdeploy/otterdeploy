/**
 * Provisional parents, rebuilt inside the rollup pass's transaction from ALL
 * their children as visible in the same snapshot, so a parent can never
 * disagree with its children. A missing child is fully Unknown time;
 * DDSketches merge exactly.
 */
import type { PgTable } from "drizzle-orm/pg-core";

import { healthProbeR1d } from "@otterdeploy/db/schema/health-data";
import {
  healthMetricR10m,
  healthMetricR1h,
  healthProbeR10m,
  healthProbeR1h,
} from "@otterdeploy/db/schema/health-data-partitioned";
import { sql } from "drizzle-orm";
import * as z from "zod";

import { DDSketch } from "./ddsketch";
import { BASE_BUCKET_MS, DAY, HOUR, METRIC_WIDTH, SKETCH_ALPHA } from "./model";
import { type MetricOut, parents, type ProbeOut, upsertMetric, upsertProbe } from "./rollup-write";
import { intArray, rowsOf, type Tx, zBytes, zNum } from "./sql";

const ZERO_DIGEST = new Uint8Array(8);

const nums = z
  .union([
    z.array(z.union([z.number(), z.string()])),
    z.instanceof(Int32Array),
    z.instanceof(Float32Array),
  ])
  .transform((xs) => Array.from(xs, Number));

const probeChild = z.object({
  series_id: zNum,
  p: zNum,
  dur_ms: nums,
  n: zNum,
  sketch: zBytes.nullable(),
  att_sketch: zBytes.nullable(),
  ledger_hw: zNum,
});
type ProbeChild = z.infer<typeof probeChild>;

interface ProbeAcc extends ProbeOut {
  kids: number;
  sk: DDSketch;
  at: DDSketch;
}

function addProbeChild(a: ProbeAcc, c: ProbeChild): void {
  a.kids++;
  for (let i = 0; i < 8; i++) a.dur[i] = (a.dur[i] ?? 0) + (c.dur_ms[i] ?? 0);
  a.n += c.n;
  a.hw = Math.max(a.hw, c.ledger_hw);
  for (const [blob, into] of [
    [c.sketch, a.sk],
    [c.att_sketch, a.at],
  ] as const) {
    if (blob === null) continue;
    const decoded = DDSketch.decode(blob);
    // A child this code wrote always decodes; a corrupt one contributes no latency.
    if (decoded.isOk()) into.merge(decoded.value);
  }
}

/** Rebuild probe parents of `childTable` into `parentTable` from all their children. */
async function rebuildProbeParents(
  tx: Tx,
  tables: { child: PgTable; parent: PgTable },
  keys: ReadonlyArray<[number, number]>,
  widths: { child: number; parent: number },
  asOf: number,
): Promise<void> {
  if (keys.length === 0) return;
  const children = rowsOf(
    await tx.execute(sql`
      select c.series_id, k.p, c.dur_ms, c.n, c.sketch, c.att_sketch, c.ledger_hw
        from unnest(${intArray(keys.map((k) => k[0]))}::bigint[], ${intArray(keys.map((k) => k[1]))}::bigint[]) as k(s, p)
        join ${tables.child} c on c.series_id = k.s and c.bucket >= k.p and c.bucket < k.p + ${widths.parent}::bigint`),
    probeChild,
  );
  const acc = new Map<string, ProbeAcc>();
  for (const [s, p] of keys) {
    acc.set(`${s}|${p}`, {
      s,
      bucket: p,
      hw: 0,
      dg: ZERO_DIGEST,
      dur: Array.from({ length: 8 }, () => 0),
      n: 0,
      sketch: null,
      att: null,
      kids: 0,
      sk: new DDSketch(SKETCH_ALPHA),
      at: new DDSketch(SKETCH_ALPHA),
    });
  }
  for (const c of children) {
    const a = acc.get(`${c.series_id}|${c.p}`);
    if (a) addProbeChild(a, c);
  }
  const out = [...acc.values()].map((a): ProbeOut => {
    const missing = widths.parent / widths.child - a.kids;
    a.dur[3] = (a.dur[3] ?? 0) + missing * widths.child;
    return {
      ...a,
      sketch: a.sk.count() > 0 ? a.sk.encode() : null,
      att: a.at.count() > 0 ? a.at.encode() : null,
    };
  });
  await upsertProbe(tx, tables.parent, out, asOf, widths.parent);
}

/** real[] with NULL elements is read as jsonb: the driver cannot decode it natively. */
const nullableNums = z.array(z.number().nullable());

const metricChild = z.object({
  series_id: zNum,
  p: zNum,
  n: zNum,
  cov_ms: zNum,
  mean: nullableNums,
  max: nullableNums,
  cnt: z.array(z.number()),
  ledger_hw: zNum,
});

interface MetricAcc extends MetricOut {
  sum: number[];
  top: number[];
}

/**
 * Hourly metric parents: each element's mean weighted by the number of
 * samples that measured it in each child (exact even when an element was
 * measured in only some samples), max of maxima, summed coverage and counts.
 */
async function rebuildMetricParents(
  tx: Tx,
  keys: ReadonlyArray<[number, number]>,
  asOf: number,
): Promise<void> {
  if (keys.length === 0) return;
  const children = rowsOf(
    await tx.execute(sql`
      select c.series_id, k.p, c.n, c.cov_ms, to_jsonb(c.mean) as mean, to_jsonb(c.max) as max,
             to_jsonb(c.cnt) as cnt, c.ledger_hw
        from unnest(${intArray(keys.map((k) => k[0]))}::bigint[], ${intArray(keys.map((k) => k[1]))}::bigint[]) as k(s, p)
        join ${healthMetricR10m} c on c.series_id = k.s and c.bucket >= k.p and c.bucket < k.p + ${HOUR}::bigint`),
    metricChild,
  );
  const acc = new Map<string, MetricAcc>();
  const zeros = () => Array.from({ length: METRIC_WIDTH }, () => 0);
  for (const [s, p] of keys) {
    acc.set(`${s}|${p}`, {
      s,
      bucket: p,
      hw: 0,
      dg: ZERO_DIGEST,
      n: 0,
      cov: 0,
      mean: [],
      max: [],
      cnt: zeros(),
      sum: zeros(),
      top: Array.from({ length: METRIC_WIDTH }, () => Number.NEGATIVE_INFINITY),
    });
  }
  for (const c of children) {
    const a = acc.get(`${c.series_id}|${c.p}`);
    if (!a) continue;
    a.n += c.n;
    a.cov += c.cov_ms;
    a.hw = Math.max(a.hw, c.ledger_hw);
    for (let i = 0; i < METRIC_WIDTH; i++) {
      const mean = c.mean[i] ?? null;
      const max = c.max[i] ?? null;
      const count = c.cnt[i] ?? 0;
      if (mean !== null && count > 0) {
        a.sum[i] = (a.sum[i] ?? 0) + mean * count;
        a.cnt[i] = (a.cnt[i] ?? 0) + count;
      }
      if (max !== null) a.top[i] = Math.max(a.top[i] ?? max, max);
    }
  }
  const out = [...acc.values()].map(
    (a): MetricOut => ({
      ...a,
      mean: a.sum.map((x, i) => ((a.cnt[i] ?? 0) === 0 ? null : x / (a.cnt[i] ?? 1))),
      max: a.top.map((m) => (Number.isFinite(m) ? m : null)),
    }),
  );
  await upsertMetric(tx, healthMetricR1h, out, asOf, HOUR);
}

/** Hour and day parents of the rebuilt base buckets; returns how many were rebuilt. */
export async function rebuildParents(
  tx: Tx,
  probeBase: ReadonlyArray<readonly [number, number]>,
  metricBase: ReadonlyArray<readonly [number, number]>,
  asOf: number,
): Promise<{ hours: number; days: number }> {
  const probeHours = parents(probeBase, HOUR);
  const metricHours = parents(metricBase, HOUR);
  await rebuildProbeParents(
    tx,
    { child: healthProbeR10m, parent: healthProbeR1h },
    probeHours,
    { child: BASE_BUCKET_MS, parent: HOUR },
    asOf,
  );
  await rebuildMetricParents(tx, metricHours, asOf);
  const probeDays = parents(probeHours, DAY);
  await rebuildProbeParents(
    tx,
    { child: healthProbeR1h, parent: healthProbeR1d },
    probeDays,
    { child: HOUR, parent: DAY },
    asOf,
  );
  return { hours: probeHours.length + metricHours.length, days: probeDays.length };
}
