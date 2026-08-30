/**
 * Metrics read side. Returns a resource's recent samples, org-scoped via a
 * join through resource → project so one tenant can't read another's series.
 *
 * Two levels, the same shape `project-aggregate.ts` uses, and for the same
 * reasons — the per-resource path simply never got them:
 *
 *  1. **SQL buckets by time × container.** A resource is not one container.
 *     Replicas, and the old and new tasks that overlap during a deploy, each
 *     write their own row on every sampler pass, all sharing one `ts`. Handed
 *     to a chart raw, those are several points at one instant at different
 *     heights, drawn as one series: a vertical spike per pass, which is what
 *     the memory chart's picket fence was.
 *  2. **The merge sums container readings per bucket.** A resource's usage is
 *     what all of its containers are using, so `containers` rides along and a
 *     bucket where only part of the replica set reported reads as partial
 *     rather than as a dip.
 *
 * Bucketing also bounds the row count. The old query returned raw rows under
 * `limit(5000)`: a day at the 30s cadence is 2,880 rows per container, so a
 * two-replica service on a 24h window blew the cap and — ordered ascending —
 * silently returned the OLDEST 5,000, ending the chart hours before now.
 */
import type { OrganizationId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { project, resource, resourceMetric } from "@otterdeploy/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";

export interface MetricPoint {
  ts: Date;
  cpuPct: number;
  memBytes: number;
  memLimitBytes: number;
  netRxBytes: number;
  netTxBytes: number;
  /** Containers that reported in this bucket. */
  containers: number;
}

/** One SQL row: a single container's readings within one bucket. */
export interface ResourceBucketRow {
  /** Bucket ordinal: epoch seconds divided by `bucketSeconds`, floored. */
  bucketEpoch: number;
  containerId: string;
  cpuPct: number;
  memBytes: number;
  memLimitBytes: number;
  netRxBytes: number;
  netTxBytes: number;
}

/**
 * Bucket width for a window: ~240 buckets, floored at the 30s sampler cadence
 * and rounded to a multiple of it (finer than a sample is fake resolution).
 *
 * Twice the resolution of the project overview, because this is one full-width
 * chart of one resource rather than a summary tile.
 */
export function chooseResourceBucketSeconds(windowMinutes: number): number {
  const target = (windowMinutes * 60) / 240;
  return Math.max(30, Math.ceil(target / 30) * 30);
}

/**
 * Sum per-container readings into one point per bucket, ascending.
 *
 * CPU and memory average within a container's bucket (several passes may land
 * in one) and then sum across containers. The network counters are cumulative,
 * so the bucket's last reading is the one that matters — `max` on a monotonic
 * counter — and those sum across containers too.
 */
export function mergeResourceBuckets(
  rows: readonly ResourceBucketRow[],
  bucketSeconds: number,
): MetricPoint[] {
  const byBucket = new Map<number, Omit<MetricPoint, "ts">>();
  for (const row of rows) {
    const b = byBucket.get(row.bucketEpoch);
    if (b) {
      b.cpuPct += row.cpuPct;
      b.memBytes += row.memBytes;
      b.memLimitBytes += row.memLimitBytes;
      b.netRxBytes += row.netRxBytes;
      b.netTxBytes += row.netTxBytes;
      b.containers += 1;
    } else {
      byBucket.set(row.bucketEpoch, {
        cpuPct: row.cpuPct,
        memBytes: row.memBytes,
        memLimitBytes: row.memLimitBytes,
        netRxBytes: row.netRxBytes,
        netTxBytes: row.netTxBytes,
        containers: 1,
      });
    }
  }
  return [...byBucket.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bucketEpoch, b]) => ({ ts: new Date(bucketEpoch * bucketSeconds * 1000), ...b }));
}

/**
 * First-level SQL: per-container readings per bucket for one resource.
 * `bucketSeconds` is a server-computed integer (never user text) inlined so
 * the SELECT and GROUP BY expressions stay textually identical.
 */
async function queryResourceMetricBuckets(input: {
  organizationId: OrganizationId;
  resourceId: ResourceId;
  since: Date;
  bucketSeconds: number;
}): Promise<ResourceBucketRow[]> {
  const step = sql.raw(String(Math.trunc(input.bucketSeconds)));
  const bucket = sql`floor(extract(epoch from ${resourceMetric.ts}) / ${step})`;
  return db
    .select({
      bucketEpoch: sql<number>`(${bucket})::float8`,
      containerId: resourceMetric.containerId,
      cpuPct: sql<number>`avg(${resourceMetric.cpuPct})::float8`,
      memBytes: sql<number>`avg(${resourceMetric.memBytes})::float8`,
      memLimitBytes: sql<number>`max(${resourceMetric.memLimitBytes})::float8`,
      netRxBytes: sql<number>`max(${resourceMetric.netRxBytes})::float8`,
      netTxBytes: sql<number>`max(${resourceMetric.netTxBytes})::float8`,
    })
    .from(resourceMetric)
    .innerJoin(resource, eq(resource.id, resourceMetric.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(
      and(
        eq(resourceMetric.resourceId, input.resourceId),
        eq(project.organizationId, input.organizationId),
        gte(resourceMetric.ts, input.since),
      ),
    )
    .groupBy(bucket, resourceMetric.containerId);
}

/** Both levels: one point per bucket for the resource's charts. */
export async function queryResourceMetrics(input: {
  organizationId: OrganizationId;
  resourceId: ResourceId;
  since: Date;
  bucketSeconds: number;
}): Promise<MetricPoint[]> {
  const rows = await queryResourceMetricBuckets(input);
  return mergeResourceBuckets(rows, input.bucketSeconds);
}
