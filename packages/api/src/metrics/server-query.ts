/**
 * Per-node metric read side. Returns one server's host series, org-scoped via
 * a join through `server` so one tenant can't read another's series even if
 * it guesses a server id. Mirrors queryResourceMetrics.
 *
 * Bucketed in SQL, not shipped raw. A report lands every 60 s, so a 24 h
 * window is 1,440 rows and 7 d is 10,080 — past the row cap, so the widest
 * window silently showed three and a half days, and every window change
 * re-drew five charts from thousands of points. The window now decides the
 * bucket (~240 points whatever the span, `chooseServerBucketSeconds`), and
 * the database does the averaging. CPU also carries the bucket's MAXIMUM:
 * a one-minute spike to 98% is exactly what an operator opens this page to
 * find, and an average over six minutes would erase it.
 */
import type { OrganizationId, ServerId } from "@otterdeploy/shared/id";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { db } from "@otterdeploy/db";
import { server } from "@otterdeploy/db/schema/server";
import { serverMetric } from "@otterdeploy/db/schema/server-metric";
import { and, asc, eq, gte, sql } from "drizzle-orm";

export interface ServerMetricPoint {
  ts: Date;
  cpuPct: number | null;
  /** Highest single report in the bucket; equals cpuPct at raw resolution. */
  cpuPctMax: number | null;
  cpuUserPct: number | null;
  cpuSystemPct: number | null;
  cpuIowaitPct: number | null;
  cpuStealPct: number | null;
  memUsedPct: number;
  memAvailableBytes: number;
  memTotalBytes: number;
  memCachedBytes: number | null;
  memBuffersBytes: number | null;
  zfsArcBytes: number | null;
  swapUsedPct: number | null;
  diskUsedPct: number | null;
  diskFreeBytes: number | null;
  diskReadBytesPerSec: number | null;
  diskWriteBytesPerSec: number | null;
  loadAvg1: number | null;
  loadAvg5: number | null;
  loadAvg15: number | null;
  netRxBytesPerSec: number | null;
  netTxBytesPerSec: number | null;
}

/** Reports arrive once a minute (HEALTH_SAMPLE_INTERVAL_MS). */
const REPORT_SECONDS = 60;
/** Points per window the charts are sized for; the same figure the resource
 *  series uses, so the two families of chart feel alike. */
const TARGET_POINTS = 240;
/** Hard ceiling on rows returned, whatever the window. With bucketing this
 *  is only reachable through a pathological bucket choice. */
const MAX_POINTS = 5000;

/** Whole minutes, never finer than one report, ~240 points per window. */
export function chooseServerBucketSeconds(windowMinutes: number): number {
  const target = (windowMinutes * 60) / TARGET_POINTS;
  return Math.max(REPORT_SECONDS, Math.ceil(target / REPORT_SECONDS) * REPORT_SECONDS);
}

export async function queryServerMetrics(input: {
  organizationId: OrganizationId;
  serverId: ServerId;
  since: Date;
  bucketSeconds: number;
}): Promise<ServerMetricPoint[]> {
  // A server-computed integer (never user text), inlined so the SELECT and
  // GROUP BY expressions stay textually identical.
  const step = sql.raw(String(Math.trunc(input.bucketSeconds)));
  const bucket = sql`floor(extract(epoch from ${serverMetric.ts}) / ${step})`;
  const avg = (column: AnyPgColumn) => sql<number | null>`avg(${column})::float8`;
  const rows = await db
    .select({
      bucketEpoch: sql<number>`(${bucket})::float8`,
      cpuPct: avg(serverMetric.cpuPct),
      cpuPctMax: sql<number | null>`max(${serverMetric.cpuPct})::float8`,
      cpuUserPct: avg(serverMetric.cpuUserPct),
      cpuSystemPct: avg(serverMetric.cpuSystemPct),
      cpuIowaitPct: avg(serverMetric.cpuIowaitPct),
      cpuStealPct: avg(serverMetric.cpuStealPct),
      memUsedPct: sql<number>`avg(${serverMetric.memUsedPct})::float8`,
      memAvailableBytes: sql<number>`avg(${serverMetric.memAvailableBytes})::float8`,
      memTotalBytes: sql<number>`max(${serverMetric.memTotalBytes})::float8`,
      memCachedBytes: avg(serverMetric.memCachedBytes),
      memBuffersBytes: avg(serverMetric.memBuffersBytes),
      zfsArcBytes: avg(serverMetric.zfsArcBytes),
      swapUsedPct: avg(serverMetric.swapUsedPct),
      diskUsedPct: avg(serverMetric.diskUsedPct),
      diskFreeBytes: avg(serverMetric.diskFreeBytes),
      diskReadBytesPerSec: avg(serverMetric.diskReadBytesPerSec),
      diskWriteBytesPerSec: avg(serverMetric.diskWriteBytesPerSec),
      loadAvg1: avg(serverMetric.loadAvg1),
      loadAvg5: avg(serverMetric.loadAvg5),
      loadAvg15: avg(serverMetric.loadAvg15),
      netRxBytesPerSec: avg(serverMetric.netRxBytesPerSec),
      netTxBytesPerSec: avg(serverMetric.netTxBytesPerSec),
    })
    .from(serverMetric)
    .innerJoin(server, eq(server.id, serverMetric.serverId))
    .where(
      and(
        eq(serverMetric.serverId, input.serverId),
        eq(server.organizationId, input.organizationId),
        gte(serverMetric.ts, input.since),
      ),
    )
    .groupBy(bucket)
    .orderBy(asc(bucket))
    .limit(MAX_POINTS);

  return rows.map(({ bucketEpoch, ...point }) => ({
    ts: new Date(bucketEpoch * input.bucketSeconds * 1000),
    ...point,
  }));
}
