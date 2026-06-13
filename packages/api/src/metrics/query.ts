/**
 * Metrics read side — returns a resource's recent samples, org-scoped via a
 * join through resource → project so one tenant can't read another's series.
 */
import type { OrganizationId, ResourceId } from "@otterdeploy/shared/id";
import { and, asc, eq, gte } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import { project, resource, resourceMetric } from "@otterdeploy/db/schema";

export interface MetricPoint {
  ts: Date;
  cpuPct: number;
  memBytes: number;
  memLimitBytes: number;
  netRxBytes: number;
  netTxBytes: number;
}

export async function queryResourceMetrics(input: {
  organizationId: OrganizationId;
  resourceId: ResourceId;
  since: Date;
}): Promise<MetricPoint[]> {
  return db
    .select({
      ts: resourceMetric.ts,
      cpuPct: resourceMetric.cpuPct,
      memBytes: resourceMetric.memBytes,
      memLimitBytes: resourceMetric.memLimitBytes,
      netRxBytes: resourceMetric.netRxBytes,
      netTxBytes: resourceMetric.netTxBytes,
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
    .orderBy(asc(resourceMetric.ts))
    .limit(5000);
}
