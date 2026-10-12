/**
 * Correction-ledger evaluation: given every retained record that can
 * influence a range (the caller supplies the predecessor and successor
 * neighbours), compute per-bucket time-weighted state durations, the
 * maintenance overlay, sample counts and latency sketches. The rollup worker
 * builds buckets with this function and the tests use it as the oracle, so
 * arrival order and duplicates cannot matter: input is canonicalised first.
 *
 * Interval rule: an observation at t with clock uncertainty u establishes its
 * state only over [t+u, min(next.t-next.u, t-u+TTL)). Everything else in the
 * range is Unknown, except time after a tombstone, which leaves the
 * denominator. A marker (gap, boot, maintenance, tombstone) is a `next` like
 * any record, so it cuts its predecessor: nothing interpolates through it.
 */
import { DDSketch } from "./ddsketch";
import {
  KIND,
  type LedgerRecord,
  METRIC_WIDTH,
  type ProbeState,
  SKETCH_ALPHA,
  STATE,
} from "./model";

/** healthy, degraded, down, unknown milliseconds. */
export type Durations = [number, number, number, number];

export interface ProbeBucket {
  start: number;
  /** Per-state milliseconds; time after a tombstone is excluded. */
  durMs: Durations;
  /** The same four, restricted to maintenance windows. */
  maintMs: Durations;
  /** Observations whose event time falls in the bucket. */
  n: number;
  sketch: DDSketch;
  attemptSketch: DDSketch;
}

export interface MetricBucket {
  start: number;
  n: number;
  /** Milliseconds covered by a fresh sample (TTL rule). */
  coverageMs: number;
  /** Per element; null where no sample in the bucket measured it. */
  mean: (number | null)[];
  max: (number | null)[];
  /** Samples that measured each element: the weight of its mean in a parent. */
  count: number[];
}

interface Interval {
  from: number;
  to: number;
  state: ProbeState;
}

interface Window {
  from: number;
  to: number;
}

/** Sort by (t, boot, seq) and drop identity duplicates and diagnostic records. */
function canonicalise(records: readonly LedgerRecord[]): LedgerRecord[] {
  const sorted = records
    .filter((r) => r.kind !== KIND.diagnostic)
    .toSorted((a, b) => a.t - b.t || a.boot - b.boot || a.seq - b.seq || a.kind - b.kind);
  const out: LedgerRecord[] = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && last.boot === r.boot && last.seq === r.seq && last.t === r.t) continue;
    out.push(r);
  }
  return out;
}

/** State intervals plus the ended (post-tombstone) point and maintenance windows. */
function intervals(records: readonly LedgerRecord[]): {
  states: Interval[];
  endedFrom: number | null;
  maintenance: Window[];
} {
  const rs = canonicalise(records);
  const states: Interval[] = [];
  const maintenance: Window[] = [];
  let endedFrom: number | null = null;
  let maintOpen: number | null = null;
  for (const [i, r] of rs.entries()) {
    if (r.kind === KIND.tombstone) endedFrom = endedFrom ?? r.t;
    if (r.kind === KIND.maintenanceStart) maintOpen = maintOpen ?? r.t;
    if (r.kind === KIND.maintenanceEnd && maintOpen !== null) {
      maintenance.push({ from: maintOpen, to: r.t });
      maintOpen = null;
    }
    if (r.kind !== KIND.observation) continue;
    const next = rs[i + 1];
    let to = r.t - r.uncMs + r.ttlMs;
    if (next) to = Math.min(to, next.t - next.uncMs);
    const from = r.t + r.uncMs;
    if (to > from) states.push({ from, to, state: r.state });
  }
  if (maintOpen !== null) maintenance.push({ from: maintOpen, to: Number.POSITIVE_INFINITY });
  return { states, endedFrom, maintenance };
}

function overlap(aFrom: number, aTo: number, bFrom: number, bTo: number): number {
  return Math.max(0, Math.min(aTo, bTo) - Math.max(aFrom, bFrom));
}

function probeDurations(
  states: readonly Interval[],
  maintenance: readonly Window[],
  start: number,
  liveEnd: number,
): Pick<ProbeBucket, "durMs" | "maintMs"> {
  const durMs: Durations = [0, 0, 0, 0];
  const maintMs: Durations = [0, 0, 0, 0];
  for (const iv of states) {
    const d = overlap(iv.from, iv.to, start, liveEnd);
    if (d === 0) continue;
    durMs[iv.state] += d;
    for (const m of maintenance) {
      maintMs[iv.state] += overlap(
        Math.max(iv.from, m.from),
        Math.min(iv.to, m.to),
        start,
        liveEnd,
      );
    }
  }
  durMs[STATE.unknown] += liveEnd - start - durMs[0] - durMs[1] - durMs[2] - durMs[3];
  let maintTotal = 0;
  for (const m of maintenance) maintTotal += overlap(m.from, m.to, start, liveEnd);
  maintMs[STATE.unknown] += maintTotal - maintMs[0] - maintMs[1] - maintMs[2] - maintMs[3];
  return { durMs, maintMs };
}

/**
 * Successful final-round and attempt latencies of observations whose event
 * time is in [start, end). Failures and Unknown never enter a sketch: they
 * are not zero-millisecond answers.
 */
function probeSamples(
  rs: readonly LedgerRecord[],
  start: number,
  end: number,
  alpha: number,
): Pick<ProbeBucket, "n" | "sketch" | "attemptSketch"> {
  const sketch = new DDSketch(alpha);
  const attemptSketch = new DDSketch(alpha);
  let n = 0;
  for (const r of rs) {
    if (r.kind !== KIND.observation || r.t < start || r.t >= end) continue;
    n++;
    const success = r.state === STATE.healthy || r.state === STATE.degraded;
    if (!success || r.latUs === null) continue;
    sketch.add(r.latUs);
    for (const a of r.attUs ?? [r.latUs]) attemptSketch.add(a);
  }
  return { n, sketch, attemptSketch };
}

/** End of the reporting interval inside [start, end): a tombstone ends it. */
function liveEndOf(endedFrom: number | null, start: number, end: number): number {
  return endedFrom === null ? end : Math.max(start, Math.min(end, endedFrom));
}

export function evaluateProbeBuckets(
  records: readonly LedgerRecord[],
  rangeStart: number,
  rangeEnd: number,
  bucketMs: number,
  alpha = SKETCH_ALPHA,
): ProbeBucket[] {
  const { states, endedFrom, maintenance } = intervals(records);
  const rs = canonicalise(records);
  const buckets: ProbeBucket[] = [];
  for (let start = rangeStart; start < rangeEnd; start += bucketMs) {
    const end = start + bucketMs;
    const liveEnd = liveEndOf(endedFrom, start, end);
    buckets.push({
      start,
      ...probeDurations(states, maintenance, start, liveEnd),
      ...probeSamples(rs, start, end, alpha),
    });
  }
  return buckets;
}

function metricValues(
  rs: readonly LedgerRecord[],
  start: number,
  end: number,
): Pick<MetricBucket, "n" | "mean" | "max" | "count"> {
  const sum = Array.from({ length: METRIC_WIDTH }, () => 0);
  const count = Array.from({ length: METRIC_WIDTH }, () => 0);
  const max = Array.from({ length: METRIC_WIDTH }, () => Number.NEGATIVE_INFINITY);
  let n = 0;
  for (const r of rs) {
    if (r.kind !== KIND.observation || r.t < start || r.t >= end || r.vals === null) continue;
    n++;
    for (const [k, v] of r.vals.slice(0, METRIC_WIDTH).entries()) {
      // Not measured this round: absent from this element's mean, never zero.
      if (v === null) continue;
      sum[k] = (sum[k] ?? 0) + v;
      count[k] = (count[k] ?? 0) + 1;
      max[k] = Math.max(max[k] ?? v, v);
    }
  }
  return {
    n,
    mean: sum.map((s, k) => ((count[k] ?? 0) === 0 ? null : s / (count[k] ?? 1))),
    max: max.map((m) => (Number.isFinite(m) ? m : null)),
    count,
  };
}

export function evaluateMetricBuckets(
  records: readonly LedgerRecord[],
  rangeStart: number,
  rangeEnd: number,
  bucketMs: number,
): MetricBucket[] {
  const { states, endedFrom } = intervals(records);
  const rs = canonicalise(records);
  const buckets: MetricBucket[] = [];
  for (let start = rangeStart; start < rangeEnd; start += bucketMs) {
    const end = start + bucketMs;
    const liveEnd = liveEndOf(endedFrom, start, end);
    let coverageMs = 0;
    for (const iv of states) coverageMs += overlap(iv.from, iv.to, start, liveEnd);
    buckets.push({ start, coverageMs, ...metricValues(rs, start, end) });
  }
  return buckets;
}

export interface Report {
  /** healthy + degraded + down + unknown over the requested time, in ms. */
  d: number;
  /** (D - unknown) / D; null when D is 0. */
  coverage: number | null;
  /** healthy / (D - unknown); null when nothing is known. Degraded is not healthy. */
  strictUptime: number | null;
}

/** A report over base buckets; maintenance is excluded only when asked. */
export function report(
  buckets: readonly Pick<ProbeBucket, "durMs" | "maintMs">[],
  excludeMaintenance = false,
): Report {
  const tot: Durations = [0, 0, 0, 0];
  for (const b of buckets) {
    for (const k of [0, 1, 2, 3] as const) {
      tot[k] += b.durMs[k] - (excludeMaintenance ? b.maintMs[k] : 0);
    }
  }
  const [healthy, degraded, down, unknown] = tot;
  const d = healthy + degraded + down + unknown;
  const known = d - unknown;
  return {
    d,
    coverage: d === 0 ? null : known / d,
    strictUptime: known === 0 ? null : healthy / known,
  };
}
