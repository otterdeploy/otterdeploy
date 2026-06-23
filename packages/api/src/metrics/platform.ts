/**
 * Install-wide platform metrics: BullMQ queue depth (sampled onto the
 * `platform_metric` time series) + deploy throughput derived from the
 * `deployment` table. Sampled on the same tick as the container sampler.
 *
 * API request latency / error rate are deliberately NOT here: those live in
 * evlog wide events with no queryable aggregation store, so surfacing them would
 * need an evlog rollup drain — a separate effort, flagged not faked.
 */
import { and, asc, eq, gte, sql } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import {
  deployment,
  platformMetric,
  project,
  resource,
} from "@otterdeploy/db/schema";
import { getAllQueues } from "@otterdeploy/jobs";
import type { OrganizationId } from "@otterdeploy/shared/id";

export interface QueueSnapshot {
  queue: string;
  waiting: number;
  active: number;
  failed: number;
  delayed: number;
  completed: number;
}

/** Live per-queue job counts (straight from BullMQ, no DB) — current backlog. */
export async function currentQueueSnapshot(): Promise<QueueSnapshot[]> {
  const snaps = await Promise.all(
    getAllQueues().map(async (q) => {
      const c = await q.getJobCounts(
        "waiting",
        "active",
        "failed",
        "delayed",
        "completed",
      );
      return {
        queue: q.name,
        waiting: c.waiting ?? 0,
        active: c.active ?? 0,
        failed: c.failed ?? 0,
        delayed: c.delayed ?? 0,
        completed: c.completed ?? 0,
      };
    }),
  );
  return snaps.sort((a, b) => a.queue.localeCompare(b.queue));
}

/**
 * Sample aggregate (summed-across-queues) backlog into `platform_metric`. Called
 * on the metrics sampler tick. Best-effort — a Redis/DB hiccup must never break
 * the tick, so it swallows errors.
 */
export async function samplePlatformMetrics(): Promise<void> {
  try {
    const snaps = await currentQueueSnapshot();
    const sum = (k: keyof QueueSnapshot) =>
      snaps.reduce((s, q) => s + (q[k] as number), 0);
    await db.insert(platformMetric).values([
      { metric: "queue.waiting", value: sum("waiting") },
      { metric: "queue.active", value: sum("active") },
      { metric: "queue.failed", value: sum("failed") },
    ]);
  } catch {
    // best-effort; next tick retries.
  }
}

export interface MetricSeriesPoint {
  ts: Date;
  value: number;
}

/** One platform metric's samples within a look-back window. */
export async function queryPlatformSeries(
  metric: string,
  since: Date,
): Promise<MetricSeriesPoint[]> {
  return db
    .select({ ts: platformMetric.ts, value: platformMetric.value })
    .from(platformMetric)
    .where(and(eq(platformMetric.metric, metric), gte(platformMetric.ts, since)))
    .orderBy(asc(platformMetric.ts));
}

export interface DeployThroughput {
  succeeded: number;
  failed: number;
  inProgress: number;
  total: number;
  /** failed / settled (succeeded + failed); 0 when nothing has settled. */
  failureRate: number;
}

/** Deploy throughput for an org over a window, derived from the deployment rows
 *  (no new sampling). `running` = succeeded, `failed` = failed, building/pending
 *  = in-progress; superseded/removed are ignored. */
export async function queryDeployThroughput(
  organizationId: OrganizationId,
  since: Date,
): Promise<DeployThroughput> {
  const rows = await db
    .select({ status: deployment.status, count: sql<number>`count(*)::int` })
    .from(deployment)
    .innerJoin(resource, eq(resource.id, deployment.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(
      and(
        eq(project.organizationId, organizationId),
        gte(deployment.createdAt, since),
      ),
    )
    .groupBy(deployment.status);

  let succeeded = 0;
  let failed = 0;
  let inProgress = 0;
  for (const r of rows) {
    if (r.status === "running") succeeded += r.count;
    else if (r.status === "failed") failed += r.count;
    else if (r.status === "building" || r.status === "pending")
      inProgress += r.count;
  }
  const settled = succeeded + failed;
  return {
    succeeded,
    failed,
    inProgress,
    total: succeeded + failed + inProgress,
    failureRate: settled ? failed / settled : 0,
  };
}
