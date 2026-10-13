/**
 * Deleting an organization removes every health row of its series: the
 * series cascade from the organization, and every ledger, raw, rollup and
 * bookkeeping table cascades from the series, partitioned tables included.
 */
import { db } from "@otterdeploy/db";
import { organization } from "@otterdeploy/db/schema/auth";
import {
  healthLedgerAnchor,
  healthProbeR1d,
  healthRebuildPending,
  healthRejected,
  healthSeries,
} from "@otterdeploy/db/schema/health-data";
import {
  healthLedger,
  healthMetricR10m,
  healthMetricR1h,
  healthMetricRaw,
  healthProbeR10m,
  healthProbeR1h,
  healthProbeRaw,
} from "@otterdeploy/db/schema/health-data-partitioned";
import { Result } from "better-result";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";
import * as z from "zod";

import { seedOrganization } from "../../__tests__/postgres-seed";
import { DAY, HOUR } from "../model";
import { ensurePartitions, PARTITIONS } from "../partitions";
import { rowsOf } from "../sql";

const NOW = 1_940_000_000_000 - (1_940_000_000_000 % DAY) + 12 * HOUR;
const BUCKET = NOW - (NOW % HOUR);

const TABLES = [
  healthLedger,
  healthProbeRaw,
  healthMetricRaw,
  healthProbeR10m,
  healthProbeR1h,
  healthProbeR1d,
  healthMetricR10m,
  healthMetricR1h,
  healthLedgerAnchor,
  healthRebuildPending,
  healthRejected,
];

const rollup = (seriesId: number) => ({
  seriesId,
  bucket: BUCKET,
  ver: 1,
  ledgerHw: 1,
  evalRev: 1,
  complete: true,
  bdigest: Buffer.from([0]),
});

async function rowsOfSeries(seriesId: number): Promise<number[]> {
  const counts: number[] = [];
  for (const table of TABLES) {
    const [row] = rowsOf(
      await db.execute(sql`select count(*) as n from ${table} where series_id = ${seriesId}`),
      z.object({ n: z.coerce.number() }),
    );
    counts.push(row?.n ?? -1);
  }
  return counts;
}

describe("organization deletion", () => {
  it("cascades through the series to every health table", async () => {
    for (const spec of PARTITIONS) (await ensurePartitions(spec, NOW - DAY, NOW + DAY)).unwrap();
    const org = await seedOrganization("health-delete");
    const [series] = await db
      .insert(healthSeries)
      .values({
        organizationId: org,
        kind: 1,
        sourceNodeId: "node-del",
        identityKey: `delete-${org}`,
        subjectId: "svc",
        nodeDimension: false,
        createdAt: NOW,
      })
      .returning({ id: healthSeries.id });
    const sid = series?.id ?? -1;
    const record = {
      seriesId: sid,
      t: NOW,
      boot: 1,
      seq: 1,
      kind: 0,
      state: 0,
      uncMs: 0,
      ttlMs: 60_000,
    };
    await db.insert(healthLedger).values({ ...record, digest: Buffer.from([1]) });
    await db.insert(healthLedgerAnchor).values({ ...record, t: NOW - DAY });
    const raw = { seriesId: sid, t: NOW, boot: 1, seq: 1, uncMs: 0, receivedAt: NOW, live: true };
    await db.insert(healthProbeRaw).values({ ...raw, round: 1, state: 0, outcome: 0, cause: 0 });
    await db.insert(healthMetricRaw).values({ ...raw, vals: [1] });
    const probeRollup = { ...rollup(sid), durMs: [0, 0, 0, 0, 0, 0, 0, 0], n: 0 };
    await db.insert(healthProbeR10m).values(probeRollup);
    await db.insert(healthProbeR1h).values(probeRollup);
    await db.insert(healthProbeR1d).values({ ...probeRollup, bucket: NOW - (NOW % DAY) });
    const metricRollup = { ...rollup(sid), n: 1, covMs: 1, mean: [1], max: [1], cnt: [1] };
    await db.insert(healthMetricR10m).values(metricRollup);
    await db.insert(healthMetricR1h).values(metricRollup);
    await db
      .insert(healthRebuildPending)
      .values({ seriesId: sid, lo: NOW, hi: NOW + 1, createdAt: NOW });
    await db
      .insert(healthRejected)
      .values({ seriesId: sid, t: NOW, boot: 1, seq: 2, reason: 2, receivedAt: NOW });
    expect(await rowsOfSeries(sid)).toEqual(TABLES.map(() => 1));

    await db.delete(organization).where(eq(organization.id, org));

    expect(await rowsOfSeries(sid)).toEqual(TABLES.map(() => 0));
  });

  it("refuses health rows for a series that does not exist", async () => {
    const orphan = await Result.tryPromise(() =>
      db.insert(healthLedger).values({
        seriesId: -42,
        t: NOW,
        boot: 1,
        seq: 1,
        kind: 0,
        state: 0,
        uncMs: 0,
        ttlMs: 1,
        digest: Buffer.from([1]),
      }),
    );
    expect(orphan.isErr()).toBe(true);
  });
});
