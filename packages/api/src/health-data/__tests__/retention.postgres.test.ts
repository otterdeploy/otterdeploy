/**
 * Retention and disk pressure on a real Postgres: horizons are published
 * before partitions are dropped and wait out in-flight ingests; the ledger is
 * anchored before its partition goes; under pressure the replay horizon moves
 * one data-bearing day per tick and marks the lost repair range incomplete.
 * The free-disk reading is injected; the real disk is never read.
 */
import type { OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { healthBatch, healthLedgerAnchor, healthMeta } from "@otterdeploy/db/schema/health-data";
import {
  healthLedger,
  healthMetricRaw,
  healthProbeR10m,
} from "@otterdeploy/db/schema/health-data-partitioned";
import { Result } from "better-result";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import * as z from "zod";

import { seedOrganization } from "../../__tests__/postgres-seed";
import { Ingestor } from "../ingest";
import { identityKey, type SeriesIdentity } from "../ingest-model";
import { DAY, HOUR, MINUTE, REPLAY_HORIZON_MS, STATE } from "../model";
import { partitionSpec, readPartitions } from "../partitions";
import { DEFAULT_THRESHOLDS, runRetention } from "../retention";
import { runRollupPass } from "../rollup";
import { rowsOf, type Tx, zNum } from "../sql";
import {
  batch,
  countOf,
  metric,
  metricSeries,
  prepareWindow,
  probe,
  probeSeries,
} from "./fixtures";

const DAY0 = 1_930_000_000_000 - (1_930_000_000_000 % DAY);
const NOW = DAY0 + 12 * HOUR;
const roomy = { freeBytes: 50, totalBytes: 100 };
const tight = { freeBytes: 10, totalBytes: 100 };
let org: OrganizationId;

async function seriesId(identity: SeriesIdentity): Promise<number> {
  const rows = rowsOf(
    await db.execute(
      sql`select id from health_series where identity_key = ${identityKey(identity)}`,
    ),
    z.object({ id: zNum }),
  );
  return rows[0]?.id ?? -1;
}

const partitionNames = async (table: Parameters<typeof partitionSpec>[0]) =>
  (await readPartitions(db, partitionSpec(table))).map((p) => p.name);

async function drain() {
  for (let i = 0; i < 50; i++) {
    if ((await runRollupPass({ asOf: NOW })).unwrap().series === 0) return;
  }
}

describe("health retention", () => {
  beforeEach(async () => {
    await prepareWindow(NOW);
    org ??= await seedOrganization("health-retention");
  });

  it("without pressure: ages out by the replay and raw horizons, anchoring the ledger first", async () => {
    const s = probeSeries(org, "age");
    const old = DAY0 - 8 * DAY + HOUR;
    (await new Ingestor().ingest(batch([probe(s, old, STATE.healthy)]), NOW)).unwrap();
    const state = (await runRetention({ now: NOW, disk: roomy })).unwrap();
    expect(state).toMatchObject({ level: 0, shortened: false });
    expect(state.horizonMs).toBe(NOW - REPLAY_HORIZON_MS);
    expect(state.rawHorizonMs).toBe(NOW - 48 * HOUR);
    expect(await partitionNames("health_ledger")).not.toContain(
      `health_ledger_p${((DAY0 - 8 * DAY) / 1000).toString()}`,
    );
    const [anchor] = await db
      .select()
      .from(healthLedgerAnchor)
      .where(eq(healthLedgerAnchor.seriesId, await seriesId(s)))
      .$withCache(false);
    expect(anchor?.t).toBe(old);
    // Older arrivals are now rejected as too old, not failed.
    const late = (
      await new Ingestor().ingest(batch([probe(s, old + MINUTE, STATE.down)]), NOW)
    ).unwrap();
    expect(late).toMatchObject({ accepted: 0, tooOld: 1 });
  });

  it("under pressure the raw window shrinks and a batch still holding the old one skips raw, not fails", async () => {
    const m = metricSeries(org, "host", "node-raw");
    const state = (
      await runRetention({ now: NOW, disk: { freeBytes: 15, totalBytes: 100 } })
    ).unwrap();
    expect(state.level).toBe(1);
    expect(state.rawHorizonMs).toBe(NOW - DEFAULT_THRESHOLDS.rawShrunkMs);
    const recent = NOW - 20 * HOUR;
    const r = (
      await new Ingestor().ingest(
        batch([metric(m, recent, [1])], { sourceNodeId: "node-raw" }),
        NOW,
      )
    ).unwrap();
    expect(r.accepted).toBe(1);
    expect(
      await countOf(
        sql`select count(*) as n from ${healthMetricRaw} where series_id = ${await seriesId(m)}`,
      ),
    ).toBe(0);
    expect(
      await countOf(
        sql`select count(*) as n from ${healthLedger} where series_id = ${await seriesId(m)}`,
      ),
    ).toBe(1);
  });

  it("level 2 moves the horizon one data-bearing day per tick, over empty partitions, keeping the predecessor as an anchor", async () => {
    const s = probeSeries(org, "pressure");
    const boundary = DAY0 - 4 * DAY;
    const ing = new Ingestor();
    // P Healthy one minute before the boundary, TTL 3 min: its partition is the oldest with data.
    (await ing.ingest(batch([probe(s, boundary - MINUTE, STATE.healthy)]), NOW)).unwrap();
    await drain();
    // The days before it are empty: the first tick must step over them.
    const first = (await runRetention({ now: NOW, disk: tight })).unwrap();
    expect(first).toMatchObject({ level: 2, shortened: true, horizonMs: boundary });
    expect(await partitionNames("health_ledger")).not.toContain(
      `health_ledger_p${((boundary - DAY) / 1000).toString()}`,
    );
    // The lost repair range is no longer advertised as complete.
    const [lost] = await db
      .select({ complete: healthProbeR10m.complete })
      .from(healthProbeR10m)
      .where(
        and(
          eq(healthProbeR10m.seriesId, await seriesId(s)),
          eq(healthProbeR10m.bucket, boundary - 10 * MINUTE),
        ),
      )
      .$withCache(false);
    expect(lost?.complete).toBe(false);
    // A correction right after the new horizon still sees P through its anchor.
    (await ing.ingest(batch([probe(s, boundary + 5 * MINUTE, STATE.healthy)]), NOW)).unwrap();
    await drain();
    const [bucket] = await db
      .select({ dur: healthProbeR10m.durMs })
      .from(healthProbeR10m)
      .where(
        and(eq(healthProbeR10m.seriesId, await seriesId(s)), eq(healthProbeR10m.bucket, boundary)),
      )
      .$withCache(false);
    expect(bucket?.dur[STATE.healthy]).toBe(5 * MINUTE);
    // The next tick moves exactly one more data-bearing day.
    const second = (await runRetention({ now: NOW, disk: tight })).unwrap();
    expect(second.horizonMs).toBe(boundary + DAY);
    // Never closer than a day to now, however long the pressure lasts.
    for (let i = 0; i < 4; i++) (await runRetention({ now: NOW, disk: tight })).unwrap();
    const [h] = await db
      .select({ v: healthMeta.v })
      .from(healthMeta)
      .where(eq(healthMeta.k, "horizon_ms"))
      .$withCache(false);
    expect(h?.v).toBeLessThanOrEqual(NOW - DAY);
  });

  it("forgets batch ids older than the replay horizon", async () => {
    const node = `node-batches-${org}`;
    await db.insert(healthBatch).values([
      { sourceNodeId: node, batchId: "old", receivedAt: NOW - REPLAY_HORIZON_MS - MINUTE },
      { sourceNodeId: node, batchId: "recent", receivedAt: NOW - HOUR },
    ]);
    (await runRetention({ now: NOW, disk: roomy })).unwrap();
    const left = await db
      .select({ id: healthBatch.batchId })
      .from(healthBatch)
      .where(eq(healthBatch.sourceNodeId, node))
      .$withCache(false);
    expect(left.map((r) => r.id)).toEqual(["recent"]);
  });

  it("the last pressure level is reported for the replay lane to refuse", async () => {
    const state = (
      await runRetention({ now: NOW, disk: { freeBytes: 5, totalBytes: 100 } })
    ).unwrap();
    expect(state.level).toBe(3);
  });

  it("publishes the replay horizon before dropping the ledger: an in-flight ingest holding the old one still commits", async () => {
    const s = probeSeries(org, "in-flight-ledger");
    (await new Ingestor().ingest(batch([probe(s, NOW - MINUTE, STATE.healthy)]), NOW)).unwrap();
    const sid = await seriesId(s);
    const expiring = DAY0 - 8 * DAY;
    const partition = `health_ledger_p${(expiring / 1000).toString()}`;
    const row = { seriesId: sid, t: expiring + HOUR, boot: 1, seq: 1, kind: 0, state: STATE.down };
    const result = await whileHolding("horizon_ms", partition, "health_ledger", (tx) =>
      tx.insert(healthLedger).values({ ...row, uncMs: 0, ttlMs: 60_000, digest: Buffer.from([1]) }),
    );
    expect(result).toEqual({
      heldBack: true,
      insertOk: true,
      retentionOk: true,
      droppedAfter: true,
    });
    const [anchor] = await db
      .select({ t: healthLedgerAnchor.t })
      .from(healthLedgerAnchor)
      .where(eq(healthLedgerAnchor.seriesId, sid))
      .$withCache(false);
    expect(anchor?.t).toBe(expiring + HOUR);
  });

  it("publishes the raw horizon before dropping raw partitions: an in-flight ingest holding the old one still commits", async () => {
    const m = metricSeries(org, "host", "node-in-flight");
    (
      await new Ingestor().ingest(
        batch([metric(m, NOW - MINUTE, [1])], { sourceNodeId: "node-in-flight" }),
        NOW,
      )
    ).unwrap();
    const sid = await seriesId(m);
    const width = partitionSpec("health_metric_raw").widthMs;
    const expiring = NOW - 48 * HOUR - ((NOW - 48 * HOUR) % width) - width;
    const partition = `health_metric_raw_p${(expiring / 1000).toString()}`;
    const result = await whileHolding("raw_horizon_ms", partition, "health_metric_raw", (tx) =>
      tx.insert(healthMetricRaw).values({
        seriesId: sid,
        t: expiring + HOUR,
        boot: 1,
        seq: 1,
        uncMs: 0,
        receivedAt: NOW,
        live: false,
        vals: [1],
      }),
    );
    expect(result).toEqual({
      heldBack: true,
      insertOk: true,
      retentionOk: true,
      droppedAfter: true,
    });
  });
});

/**
 * Run a retention tick while a transaction (standing in for an ingest batch)
 * holds one horizon row FOR SHARE, then inserts into the partition that tick
 * expires. Reports whether the drop waited for it and whether its insert,
 * which read the old horizon, still landed.
 */
async function whileHolding(
  key: "horizon_ms" | "raw_horizon_ms",
  partition: string,
  table: Parameters<typeof partitionSpec>[0],
  insert: (tx: Tx) => Promise<unknown>,
) {
  expect(await partitionNames(table)).toContain(partition);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let read: () => void = () => undefined;
  const horizonRead = new Promise<void>((resolve) => {
    read = resolve;
  });
  const inFlight = Result.tryPromise(() =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select v from ${healthMeta} where k = ${key} for share`);
      read();
      await gate;
      await insert(tx);
    }),
  );
  await horizonRead;
  const tick = runRetention({ now: NOW, disk: roomy });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const heldBack = (await partitionNames(table)).includes(partition);
  release();
  const insertOk = (await inFlight).isOk();
  const retentionOk = (await tick).isOk();
  const droppedAfter = !(await partitionNames(table)).includes(partition);
  return { heldBack, insertOk, retentionOk, droppedAfter };
}
