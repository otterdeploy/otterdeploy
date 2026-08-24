/**
 * Per-node metric read side. Returns one server's recent host samples,
 * org-scoped via a join through `server` so one tenant can't read another's
 * series even if it guesses a server id. Mirrors queryResourceMetrics.
 */
import type { OrganizationId, ServerId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { server } from "@otterdeploy/db/schema/server";
import { serverMetric } from "@otterdeploy/db/schema/server-metric";
import { and, asc, eq, gte } from "drizzle-orm";

export interface ServerMetricPoint {
  ts: Date;
  cpuPct: number | null;
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

/** Same bound as the container series: a window wide enough to be useful,
 *  narrow enough that one request can never page a whole retention window
 *  into memory. */
const MAX_POINTS = 5000;

export async function queryServerMetrics(input: {
  organizationId: OrganizationId;
  serverId: ServerId;
  since: Date;
}): Promise<ServerMetricPoint[]> {
  return db
    .select({
      ts: serverMetric.ts,
      cpuPct: serverMetric.cpuPct,
      cpuUserPct: serverMetric.cpuUserPct,
      cpuSystemPct: serverMetric.cpuSystemPct,
      cpuIowaitPct: serverMetric.cpuIowaitPct,
      cpuStealPct: serverMetric.cpuStealPct,
      memUsedPct: serverMetric.memUsedPct,
      memAvailableBytes: serverMetric.memAvailableBytes,
      memTotalBytes: serverMetric.memTotalBytes,
      memCachedBytes: serverMetric.memCachedBytes,
      memBuffersBytes: serverMetric.memBuffersBytes,
      zfsArcBytes: serverMetric.zfsArcBytes,
      swapUsedPct: serverMetric.swapUsedPct,
      diskUsedPct: serverMetric.diskUsedPct,
      diskFreeBytes: serverMetric.diskFreeBytes,
      diskReadBytesPerSec: serverMetric.diskReadBytesPerSec,
      diskWriteBytesPerSec: serverMetric.diskWriteBytesPerSec,
      loadAvg1: serverMetric.loadAvg1,
      loadAvg5: serverMetric.loadAvg5,
      loadAvg15: serverMetric.loadAvg15,
      netRxBytesPerSec: serverMetric.netRxBytesPerSec,
      netTxBytesPerSec: serverMetric.netTxBytesPerSec,
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
    .orderBy(asc(serverMetric.ts))
    .limit(MAX_POINTS);
}
