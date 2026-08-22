import type { Context } from "hono";

/**
 * Health-report ingest. The control-plane side of the per-node health agent
 * (docs/designs/server-health-agent.md). Remote agents (and the local 60s
 * sampler, which calls recordHealthSample directly) land here; the latest
 * snapshot per server is UPSERTED into server_health_sample.
 *
 * Each accepted report ALSO appends a row to `server_metric`: the snapshot
 * table is upserted in place (one row per server, backing the fast servers-list
 * read), so it is the append-only series next to it that gives remote nodes any
 * history at all.
 *
 * Attribution reuses the stats.ts convention: the claimed hostname matches a
 * server row's `hostname` OR `name`, across ALL orgs (the same machine has
 * one bootstrap row per org). Unknown hostname ⇒ accepted-but-unmatched (202
 * semantics): registration stays an explicit UI act, no ghost rows, but the
 * agent shouldn't retry-loop on it.
 *
 * Reports also backfill capacity (cpuTotal/memTotalGb) onto matched rows that
 * still carry the zero placeholder from the join flow, the self-registration
 * the server contract reserved.
 */
import { db } from "@otterdeploy/db";
import { server, serverHealthSample } from "@otterdeploy/db/schema/server";
import { serverMetric } from "@otterdeploy/db/schema/server-metric";
import { eq, or } from "drizzle-orm";
import { log } from "evlog";
import * as z from "zod";

import { verifyAgentToken } from "./agent-token";
import { deriveServerMetricValues } from "./metric-row";

/**
 * Payload validation is deliberately shallow: `health` is the HostHealth
 * shape but agents may run a newer/older image than the control plane, so we
 * pin only what attribution and staleness need and store the rest as-is.
 *
 * The telemetry sections are `.nullish()` (optional AND nullable) so an agent
 * running an OLDER image, which posts only memory/disk/docker, still ingests
 * cleanly, and so does a node that could read none of them. The series
 * columns are derived separately, in metric-row.ts, which tolerates every
 * field being absent.
 *
 * Exported for tests: a version-skew contract is only real if it is asserted.
 */
export const reportSchema = z.looseObject({
  hostname: z.string().min(1),
  health: z.looseObject({
    memory: z.looseObject({ totalBytes: z.number() }),
    sampledAt: z.string().min(1),
    cpu: z.looseObject({}).nullish(),
    load: z.looseObject({}).nullish(),
    filesystems: z.array(z.looseObject({})).nullish(),
    diskIo: z.array(z.looseObject({})).nullish(),
    network: z.array(z.looseObject({})).nullish(),
  }),
  capacity: z
    .object({ cpuTotal: z.number().int().nonnegative(), memTotalGb: z.number().nonnegative() })
    .nullable()
    .optional(),
});

export type AgentHealthReport = z.infer<typeof reportSchema>;

/** Structural write shape. What recordHealthSample actually needs. Both the
 *  parsed ingest payload and a locally-sampled HostHealth satisfy it. */
export interface HealthSampleWrite {
  hostname: string;
  health: { memory: { totalBytes: number }; sampledAt: string };
  capacity?: { cpuTotal: number; memTotalGb: number } | null;
}

type ServerRow = typeof server.$inferSelect;

/** Upsert the latest snapshot for each matched row, append the time-series
 *  row, and backfill placeholder capacity. Shared by the ingest route and the
 *  local sampler. */
export async function recordHealthSample(
  rows: Array<Pick<ServerRow, "id" | "organizationId" | "cpuTotal" | "memTotalGb">>,
  report: HealthSampleWrite,
): Promise<void> {
  const sampledAtDate = new Date(report.health.sampledAt);
  const sampledAt = Number.isNaN(sampledAtDate.getTime()) ? new Date() : sampledAtDate;
  // Derived once: the same payload produces the same series row for every
  // matched org row. Null ⇒ the payload had no readable memory block, so
  // there is nothing honest to append (the snapshot still lands).
  const metricValues = deriveServerMetricValues(report.health);
  // The series is stamped with OUR clock, not the agent's. `sampledAt` is
  // kept as reported on the snapshot for audit, but a node whose clock is
  // minutes off would otherwise land its points outside (or ahead of) every
  // window the charts ask for. Same reasoning as judging staleness on
  // receivedAt, and the same clock resource_metric's defaultNow() uses.
  const receivedAt = new Date();

  for (const row of rows) {
    await db
      .insert(serverHealthSample)
      .values({
        serverId: row.id,
        organizationId: row.organizationId,
        hostname: report.hostname,
        payload: report.health,
        sampledAt,
        receivedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: serverHealthSample.serverId,
        set: {
          hostname: report.hostname,
          payload: report.health,
          sampledAt,
          receivedAt: new Date(),
        },
      });

    // Append-only history. The snapshot above is one row per server forever;
    // this is the series the per-node charts read.
    if (metricValues) {
      await db.insert(serverMetric).values({
        serverId: row.id,
        organizationId: row.organizationId,
        ts: receivedAt,
        ...metricValues,
      });
    }

    // Self-registration: fill capacity only where the join flow left zeros.
    // An operator-entered value is never overwritten by an agent.
    const capacity = report.capacity;
    if (capacity && (row.cpuTotal === 0 || row.memTotalGb === 0)) {
      await db
        .update(server)
        .set({
          cpuTotal: row.cpuTotal === 0 ? capacity.cpuTotal : row.cpuTotal,
          memTotalGb: row.memTotalGb === 0 ? Math.round(capacity.memTotalGb) : row.memTotalGb,
        })
        .where(eq(server.id, row.id));
    }
  }
}

/** Match a claimed hostname to server rows (hostname OR name, all orgs). */
async function matchServersByHostname(hostname: string) {
  return db
    .select({
      id: server.id,
      organizationId: server.organizationId,
      cpuTotal: server.cpuTotal,
      memTotalGb: server.memTotalGb,
    })
    .from(server)
    .where(or(eq(server.hostname, hostname), eq(server.name, hostname)));
}

/** POST /api/agent/health: Bearer agent-token, body = AgentHealthReport. */
export async function agentHealthIngestHandler(c: Context): Promise<Response> {
  const auth = c.req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!token || !(await verifyAgentToken(token))) {
    return c.json({ error: "invalid agent token" }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid report shape" }, 400);

  const rows = await matchServersByHostname(parsed.data.hostname);
  if (rows.length === 0) {
    log.warn({ healthAgent: { event: "unmatched-report", hostname: parsed.data.hostname } });
    return c.json({ ok: true, matched: 0 }, 202);
  }

  await recordHealthSample(rows, parsed.data);
  return c.json({ ok: true, matched: rows.length });
}

/** Sample cadence; the read path treats > 3× this as stale. */
export const HEALTH_SAMPLE_INTERVAL_MS = 60_000;
