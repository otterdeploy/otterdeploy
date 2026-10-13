/**
 * Ingest + rollup on a real Postgres. Whatever the arrival order, duplicates
 * and interleaving with rollup passes, published buckets must end equal to
 * the evaluator over the same records, parents must equal
 * their children, and a pass must publish atomically.
 */
import type { OrganizationId } from "@otterdeploy/shared/id";
import type { PgTable } from "drizzle-orm/pg-core";

import { db } from "@otterdeploy/db";
import {
  healthProbeR1d,
  healthRebuildPending,
  healthSeries,
} from "@otterdeploy/db/schema/health-data";
import {
  healthMetricR10m,
  healthMetricR1h,
  healthProbeR10m,
  healthProbeR1h,
  healthProbeRaw,
} from "@otterdeploy/db/schema/health-data-partitioned";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import * as z from "zod";

import { seedOrganization } from "../../__tests__/postgres-seed";
import { evaluateProbeBuckets, report } from "../evaluate";
import { Ingestor } from "../ingest";
import { identityKey, type IngestRecord, type SeriesIdentity } from "../ingest-model";
import { fetchLedger } from "../ledger-read";
import { ceilTo, DAY, floorTo, HOUR, KIND, type LedgerRecord, MINUTE, STATE } from "../model";
import { rollupLagMs, runRollupPass } from "../rollup";
import { rowsOf, zNum } from "../sql";
import {
  batch,
  countOf,
  metric,
  metricSeries,
  mix,
  prepareWindow,
  probe,
  probeSeries,
} from "./fixtures";

const NOW = 1_920_000_000_000 - (1_920_000_000_000 % DAY) + 12 * HOUR;
/** "12:00": a ten-minute boundary two hours before NOW. */
const T0 = NOW - 2 * HOUR;
const at = (min: number) => T0 + Math.round(min * MINUTE);
let org: OrganizationId;

async function drain(asOf = NOW): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const r = (await runRollupPass({ asOf })).unwrap();
    if (r.series === 0) return;
  }
  throw new Error("rollup did not drain");
}

async function seriesId(identity: SeriesIdentity): Promise<number> {
  const [row] = await db
    .select({ id: healthSeries.id })
    .from(healthSeries)
    .where(eq(healthSeries.identityKey, identityKey(identity)))
    .$withCache(false);
  return row?.id ?? -1;
}

const bucketRow = z.object({ bucket: zNum, dur: z.array(z.number()), ver: zNum });

/** Published probe buckets of one tier, oldest first. */
async function published(identity: SeriesIdentity, table: PgTable = healthProbeR10m) {
  const sid = await seriesId(identity);
  return rowsOf(
    await db.execute(sql`select bucket, to_jsonb(dur_ms) as dur, ver from ${table}
                          where series_id = ${sid} order by bucket`),
    bucketRow,
  );
}

const minutesAt = async (identity: SeriesIdentity, bucket: number) =>
  (await published(identity))
    .find((b) => b.bucket === bucket)
    ?.dur.slice(0, 4)
    .map((d) => d / MINUTE);

const asLedger = (r: IngestRecord): LedgerRecord => ({
  t: r.t,
  boot: 1,
  seq: r.seq,
  kind: KIND.observation,
  state: r.state,
  uncMs: r.uncMs,
  ttlMs: r.ttlMs,
  latUs: r.latUs,
  attUs: r.attUs,
  vals: null,
});

function permutations<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [[...xs]];
  return xs.flatMap((x, i) =>
    permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]),
  );
}

describe("ingest and rollup", () => {
  beforeAll(async () => {
    await prepareWindow(NOW);
    org = await seedOrganization("health-rollup");
  });

  it("reports rollup lag as the age of the oldest pending obligation", async () => {
    await drain();
    expect((await rollupLagMs(NOW)).unwrap()).toBe(0);
    const s = probeSeries(org, "lag");
    (await new Ingestor().ingest(batch([probe(s, at(1), STATE.healthy)]), NOW - 90_000)).unwrap();
    expect((await rollupLagMs(NOW)).unwrap()).toBe(90_000);
    await drain();
    expect((await rollupLagMs(NOW)).unwrap()).toBe(0);
  });

  it("worked example: every arrival order with a duplicate, a pass after each arrival", async () => {
    const orders = permutations(["H04", "D06", "H04dup"] as const);
    for (const [i, order] of orders.entries()) {
      const s = probeSeries(org, `example-${i}`);
      const byName = {
        H04: probe(s, at(4), STATE.healthy),
        D06: probe(s, at(6), STATE.down),
        H04dup: probe(s, at(4), STATE.healthy),
      };
      const ing = new Ingestor();
      for (const [k, name] of order.entries()) {
        (await ing.ingest(batch([byName[name]]), NOW)).unwrap();
        await drain();
        if (k === 0 && name !== "D06") expect(await minutesAt(s, T0)).toEqual([3, 0, 0, 7]);
      }
      expect(await minutesAt(s, T0)).toEqual([2, 0, 3, 5]);
      const [b] = (await published(s)).filter((x) => x.bucket === T0);
      const durs = b?.dur ?? [];
      const r = report([
        {
          durMs: [durs[0] ?? 0, durs[1] ?? 0, durs[2] ?? 0, durs[3] ?? 0],
          maintMs: [0, 0, 0, 0],
        },
      ]);
      expect(r).toEqual({ d: 10 * MINUTE, coverage: 0.5, strictUptime: 0.4 });
    }
  });

  it("split buckets: Healthy 12:09 and Down 12:11 rebuild both buckets, either order", async () => {
    for (const [i, reversed] of [false, true].entries()) {
      const s = probeSeries(org, `split-${i}`);
      const records = [probe(s, at(9), STATE.healthy), probe(s, at(11), STATE.down)];
      const ing = new Ingestor();
      for (const r of reversed ? records.toReversed() : records) {
        (await ing.ingest(batch([r]), NOW)).unwrap();
        await drain();
      }
      expect(await minutesAt(s, T0)).toEqual([1, 0, 0, 9]);
      expect(await minutesAt(s, T0 + 10 * MINUTE)).toEqual([1, 0, 3, 6]);
    }
  });

  it("a 12:04 result arriving after raw expiry but within seven days gives the same answer", async () => {
    const s = probeSeries(org, "late");
    const ing = new Ingestor();
    (await ing.ingest(batch([probe(s, at(6), STATE.down)]), NOW)).unwrap();
    await drain();
    const late = NOW + 3 * DAY;
    const r = (await ing.ingest(batch([probe(s, at(4), STATE.healthy)]), late)).unwrap();
    expect(r.accepted).toBe(1);
    await drain(late);
    expect(await minutesAt(s, T0)).toEqual([2, 0, 3, 5]);
    expect(
      await countOf(sql`select count(*) as n from ${healthProbeRaw}
                        where series_id = ${await seriesId(s)} and t = ${at(4)}`),
    ).toBe(0);
  });

  it("300 observations in random order, in batches between passes, equal the oracle", async () => {
    const s = probeSeries(org, "random");
    const obs = Array.from({ length: 300 }, (_, i) => {
      const state = mix(i, 5) < 0.2 ? STATE.down : mix(i, 6) < 0.1 ? STATE.degraded : STATE.healthy;
      const t = at(i * 0.37 + (mix(i, 9) - 0.5) * 0.2);
      return probe(s, t, state, { seq: i + 1, uncMs: Math.round(mix(i, 4) * 20_000) });
    });
    const shuffled = obs.toSorted((a, b) => mix(a.seq, 1) - mix(b.seq, 1));
    const ing = new Ingestor();
    for (let i = 0; i < shuffled.length; i += 17) {
      (await ing.ingest(batch(shuffled.slice(i, i + 17)), NOW)).unwrap();
      if (i % 51 === 0) await drain();
    }
    await drain();
    const got = await published(s);
    const first = got[0]?.bucket ?? 0;
    const expected = evaluateProbeBuckets(
      obs.map(asLedger),
      first,
      (got.at(-1)?.bucket ?? 0) + 10 * MINUTE,
      10 * MINUTE,
    );
    expect(got.map((g) => g.dur)).toEqual(expected.map((e) => [...e.durMs, ...e.maintMs]));
  });

  it("an insert with less uncertainty than its successor lengthens the predecessor into an earlier bucket", async () => {
    const s = probeSeries(org, "lengthen");
    const ing = new Ingestor();
    // P Down at 12:09:30 (u 20 s); S at 12:10:30 (u 48 s) cuts P at 12:09:42, before P starts.
    (
      await ing.ingest(
        batch([
          probe(s, at(9.5), STATE.down, { uncMs: 20_000, ttlMs: 135_000 }),
          probe(s, at(10.5), STATE.healthy, { uncMs: 48_000, ttlMs: 135_000 }),
        ]),
        NOW,
      )
    ).unwrap();
    await drain();
    expect((await minutesAt(s, T0))?.[2]).toBe(0);
    // A gap marker at 12:10 (u 0) moves P's cut to 12:10: Down [12:09:50, 12:10) in the FIRST bucket.
    (
      await ing.ingest(
        batch([], {
          markers: [
            { kind: KIND.gapStart, t: at(10), seq: 1, target: { kind: "series", identity: s } },
          ],
        }),
        NOW,
      )
    ).unwrap();
    await drain();
    const [b] = (await published(s)).filter((x) => x.bucket === T0);
    expect(b?.dur[2]).toBe(10_000);
  });

  it("hour and day parents equal their children; a missing child is Unknown time", async () => {
    const s = probeSeries(org, "parents");
    const records = [at(1), at(12), at(25), at(47)].map((t, i) =>
      probe(s, t, i === 2 ? STATE.down : STATE.healthy, { latUs: 1_000 * (i + 1) }),
    );
    (await new Ingestor().ingest(batch(records), NOW)).unwrap();
    await drain();
    const hourStart = T0 - (T0 % HOUR);
    const children = (await published(s)).filter(
      (c) => c.bucket >= hourStart && c.bucket < hourStart + HOUR,
    );
    const hour = (await published(s, healthProbeR1h)).find((h) => h.bucket === hourStart);
    const sum = Array.from({ length: 8 }, (_, k) =>
      children.reduce((acc, c) => acc + (c.dur[k] ?? 0), 0),
    );
    sum[3] = (sum[3] ?? 0) + (6 - children.length) * 10 * MINUTE;
    expect(hour?.dur).toEqual(sum);
    const hours = await published(s, healthProbeR1h);
    const dayStart = T0 - (T0 % DAY);
    const [day] = await db
      .select({ dur: healthProbeR1d.durMs })
      .from(healthProbeR1d)
      .where(
        and(eq(healthProbeR1d.seriesId, await seriesId(s)), eq(healthProbeR1d.bucket, dayStart)),
      )
      .$withCache(false);
    const daySum = Array.from({ length: 8 }, (_, k) =>
      hours.reduce((acc, h) => acc + (h.dur[k] ?? 0), 0),
    );
    daySum[3] = (daySum[3] ?? 0) + (24 - hours.length) * HOUR;
    expect(day?.dur).toEqual(daySum);
  });

  it("metric rollups keep unmeasured elements null and weight hourly means by each element's own count", async () => {
    const m = metricSeries(org, "host", "node-metric");
    const second = [null, 4, 10, 10];
    const samples = [0, 1, 2, 3].map((i) =>
      metric(m, at(i * 5), [10 * (i + 1), second[i] ?? null, null]),
    );
    (await new Ingestor().ingest(batch(samples, { sourceNodeId: "node-metric" }), NOW)).unwrap();
    await drain();
    const sid = await seriesId(m);
    const metricRow = z.object({
      cnt: z.array(z.number()),
      n: zNum,
      mean: z.array(z.number().nullable()),
      max: z.array(z.number().nullable()),
    });
    const read = async (table: PgTable, bucket: number) =>
      rowsOf(
        await db.execute(sql`select n, to_jsonb(mean) as mean, to_jsonb(max) as max, to_jsonb(cnt) as cnt from ${table}
                              where series_id = ${sid} and bucket = ${bucket}`),
        metricRow,
      )[0];
    const base = await read(healthMetricR10m, T0);
    expect(base?.n).toBe(2);
    expect(base?.mean.slice(0, 3)).toEqual([15, 4, null]);
    expect(base?.cnt.slice(0, 3)).toEqual([2, 1, 0]);
    expect(base?.max.slice(0, 3)).toEqual([20, 4, null]);
    const hour = await read(healthMetricR1h, T0 - (T0 % HOUR));
    expect(hour?.n).toBe(4);
    // Element 1: (4×1 + 10×2) / 3 = 8; weighting by bucket sample count would say 7.
    expect(hour?.mean.slice(0, 3)).toEqual([25, 8, null]);
    expect(hour?.cnt.slice(0, 3)).toEqual([4, 3, 0]);
    expect(hour?.max.slice(0, 3)).toEqual([40, 10, null]);
  });

  it("publishes atomically: a concurrent ingest during a build keeps its own obligation", async () => {
    const s = probeSeries(org, "atomic");
    const ing = new Ingestor();
    (
      await ing.ingest(batch([probe(s, at(2), STATE.healthy), probe(s, at(4), STATE.down)]), NOW)
    ).unwrap();
    await drain();
    const before = await published(s);
    const sid = await seriesId(s);
    // A new record that changes two published buckets.
    (
      await ing.ingest(batch([probe(s, at(9), STATE.healthy, { ttlMs: 4 * MINUTE })]), NOW)
    ).unwrap();
    let readerSaw: typeof before = [];
    const late = probe(s, at(3), STATE.degraded);
    const pass = await runRollupPass({
      asOf: NOW,
      duringBuild: async () => {
        // Committed while the build is open: not in the pass's snapshot.
        (await new Ingestor().ingest(batch([late]), NOW)).unwrap();
        readerSaw = await published(s);
      },
    });
    expect(pass.unwrap().obligations).toBeGreaterThan(0);
    // A reader during the build sees the previous complete version, never a mix.
    expect(readerSaw).toEqual(before);
    const left = await db
      .select()
      .from(healthRebuildPending)
      .where(eq(healthRebuildPending.seriesId, sid))
      .$withCache(false);
    expect(left).toHaveLength(1);
    await drain();
    const all = [
      probe(s, at(2), STATE.healthy),
      probe(s, at(4), STATE.down),
      probe(s, at(9), STATE.healthy, { ttlMs: 4 * MINUTE }),
      late,
    ];
    const got = await published(s);
    const expected = evaluateProbeBuckets(
      all.map(asLedger),
      got[0]?.bucket ?? 0,
      (got.at(-1)?.bucket ?? 0) + 10 * MINUTE,
      10 * MINUTE,
    );
    expect(got.map((g) => g.dur)).toEqual(expected.map((e) => [...e.durMs, ...e.maintMs]));
  });

  it("two overlapping passes conflict; the loser retries and the result is the oracle's", async () => {
    const s = probeSeries(org, "overlap");
    const records = [probe(s, at(1), STATE.healthy), probe(s, at(3), STATE.down)];
    (await new Ingestor().ingest(batch(records), NOW)).unwrap();
    let second: ReturnType<typeof runRollupPass> | null = null;
    const first = await runRollupPass({
      asOf: NOW,
      duringBuild: async () => {
        // The other pass claims, builds and commits the same buckets meanwhile.
        second ??= runRollupPass({ asOf: NOW });
        await second;
      },
    });
    const other = await (second ?? runRollupPass({ asOf: NOW }));
    // The pass that committed second hit a serialization failure and retried;
    // its retry found nothing left to claim.
    expect(other.isOk()).toBe(true);
    expect(first.unwrap()).toMatchObject({ retries: 1, obligations: 0 });
    await drain();
    const got = await published(s);
    const expected = evaluateProbeBuckets(
      records.map(asLedger),
      got[0]?.bucket ?? 0,
      (got.at(-1)?.bucket ?? 0) + 10 * MINUTE,
      10 * MINUTE,
    );
    expect(got.map((g) => g.dur)).toEqual(expected.map((e) => [...e.durMs, ...e.maintMs]));
  });

  it("readers never see a half-rebuilt neighbour or a parent that disagrees with its children", async () => {
    const s = probeSeries(org, "churn");
    const obs = Array.from({ length: 120 }, (_, i) =>
      probe(s, at(i * 0.9), mix(i, 3) < 0.3 ? STATE.down : STATE.healthy, { seq: i + 1 }),
    ).toSorted((a, b) => mix(a.seq, 7) - mix(b.seq, 7));
    const violations: string[] = [];
    let done = false;
    const ing = new Ingestor();
    const writer = (async () => {
      for (let i = 0; i < obs.length; i += 6) {
        (await ing.ingest(batch(obs.slice(i, i + 6)), NOW)).unwrap();
      }
    })();
    const worker = (async () => {
      while (!done) (await runRollupPass({ asOf: NOW })).unwrap();
    })();
    const checker = (async () => {
      while (!done) violations.push(...(await checkSnapshot(s)));
    })();
    await writer;
    await drain();
    done = true;
    await Promise.all([worker, checker]);
    violations.push(...(await checkSnapshot(s)));
    expect(violations).toEqual([]);
  });
});

/**
 * In one repeatable-read snapshot: every published base bucket outside a
 * pending range equals the evaluator over the ledger, and every hour bucket
 * equals its children.
 */
async function checkSnapshot(identity: SeriesIdentity): Promise<string[]> {
  const sid = await seriesId(identity);
  return db.transaction(
    async (tx) => {
      const out: string[] = [];
      const pending = await tx
        .select()
        .from(healthRebuildPending)
        .where(eq(healthRebuildPending.seriesId, sid))
        .$withCache(false);
      const base = await tx
        .select({ bucket: healthProbeR10m.bucket, dur: healthProbeR10m.durMs })
        .from(healthProbeR10m)
        .where(eq(healthProbeR10m.seriesId, sid))
        .$withCache(false);
      for (const b of base) {
        const end = b.bucket + 10 * MINUTE;
        const rebuilding = pending.some(
          (p) => floorTo(p.lo, 10 * MINUTE) < end && b.bucket < ceilTo(p.hi, 10 * MINUTE),
        );
        if (rebuilding) continue;
        const fetched = await fetchLedger(tx, [{ seriesId: sid, lo: b.bucket, hi: end }]);
        const [e] = evaluateProbeBuckets(
          fetched.get(sid)?.records ?? [],
          b.bucket,
          end,
          10 * MINUTE,
        );
        const want = e ? [...e.durMs, ...e.maintMs] : [];
        if (JSON.stringify(want) !== JSON.stringify(b.dur)) out.push(`base ${b.bucket}`);
      }
      const hours = await tx
        .select({ bucket: healthProbeR1h.bucket, dur: healthProbeR1h.durMs })
        .from(healthProbeR1h)
        .where(eq(healthProbeR1h.seriesId, sid))
        .$withCache(false);
      for (const h of hours) {
        const kids = base.filter((b) => b.bucket >= h.bucket && b.bucket < h.bucket + HOUR);
        const sum = Array.from({ length: 8 }, (_, k) =>
          kids.reduce((a, c) => a + (c.dur[k] ?? 0), 0),
        );
        sum[3] = (sum[3] ?? 0) + (6 - kids.length) * 10 * MINUTE;
        if (JSON.stringify(sum) !== JSON.stringify(h.dur)) out.push(`hour ${h.bucket}`);
      }
      return out;
    },
    { isolationLevel: "repeatable read" },
  );
}
