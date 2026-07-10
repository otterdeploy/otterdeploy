/**
 * Project-wide metrics aggregate for `metrics.projectAggregate`.
 *
 * SQL does the first level (bucket × container → avg cpu/mem), which bounds
 * the row count at buckets × containers regardless of window length; the pure
 * `mergeAggregateBuckets` below does the second level (sum container averages
 * per bucket). Summing bucket-*averages* rather than raw samples keeps a
 * container that happened to sample twice in a bucket from counting double.
 *
 * Honesty rule: a bucket where no container reported is omitted entirely — a
 * gap in the chart — never zero-filled as if 0% CPU was measured. `containers`
 * carries how many reported so partial buckets are distinguishable too.
 */

import type { OrganizationId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { project, resource, resourceMetric } from "@otterdeploy/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";

/** One SQL row: a single container's bucket-average within the window. */
export interface AggregateBucketRow {
  /** Bucket ordinal — epoch seconds divided by `bucketSeconds`, floored. */
  bucketEpoch: number;
  containerId: string;
  cpuPct: number;
  memBytes: number;
}

export interface AggregatePoint {
  ts: Date;
  cpuPct: number;
  memBytes: number;
  containers: number;
}

/**
 * Bucket width for a window: ~120 buckets, floored at the 30s sampler cadence
 * and rounded to a multiple of it (finer than a sample is fake resolution).
 */
export function chooseBucketSeconds(windowMinutes: number): number {
  const target = (windowMinutes * 60) / 120;
  return Math.max(30, Math.ceil(target / 30) * 30);
}

/**
 * Sum per-container bucket averages into one point per bucket, ascending.
 * Rows arrive one per bucket × container, so the container count per bucket
 * is simply how many rows landed in it.
 */
export function mergeAggregateBuckets(
  rows: AggregateBucketRow[],
  bucketSeconds: number,
): AggregatePoint[] {
  const byBucket = new Map<number, { cpuPct: number; memBytes: number; containers: number }>();
  for (const row of rows) {
    const b = byBucket.get(row.bucketEpoch);
    if (b) {
      b.cpuPct += row.cpuPct;
      b.memBytes += row.memBytes;
      b.containers += 1;
    } else {
      byBucket.set(row.bucketEpoch, {
        cpuPct: row.cpuPct,
        memBytes: row.memBytes,
        containers: 1,
      });
    }
  }
  return [...byBucket.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bucketEpoch, b]) => ({
      ts: new Date(bucketEpoch * bucketSeconds * 1000),
      cpuPct: b.cpuPct,
      memBytes: b.memBytes,
      containers: b.containers,
    }));
}

/**
 * First-level SQL: avg cpu/mem per bucket per container across the project,
 * org-guarded via the resource → project join (same tenancy rule as
 * queryResourceMetrics). `bucketSeconds` is a server-computed integer
 * (never user text) inlined so the SELECT and GROUP BY expressions stay
 * textually identical.
 */
export async function queryProjectAggregateBuckets(input: {
  organizationId: OrganizationId;
  projectId: ProjectId;
  since: Date;
  bucketSeconds: number;
}): Promise<AggregateBucketRow[]> {
  const step = sql.raw(String(Math.trunc(input.bucketSeconds)));
  const bucket = sql`floor(extract(epoch from ${resourceMetric.ts}) / ${step})`;
  return db
    .select({
      bucketEpoch: sql<number>`(${bucket})::float8`,
      containerId: resourceMetric.containerId,
      cpuPct: sql<number>`avg(${resourceMetric.cpuPct})::float8`,
      memBytes: sql<number>`avg(${resourceMetric.memBytes})::float8`,
    })
    .from(resourceMetric)
    .innerJoin(resource, eq(resource.id, resourceMetric.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(
      and(
        eq(resource.projectId, input.projectId),
        eq(project.organizationId, input.organizationId),
        gte(resourceMetric.ts, input.since),
      ),
    )
    .groupBy(bucket, resourceMetric.containerId);
}
