import type { OrganizationId, ServerId } from "@otterdeploy/shared/id";
import type { Context } from "hono";

/**
 * Health-report ingest — the control-plane side of the per-node health agent
 * (docs/designs/server-health-agent.md). Remote agents (and the local 60s
 * sampler, which calls recordHealthSample directly) land here; the latest
 * snapshot per server is UPSERTED into server_health_sample.
 *
 * Attribution reuses the stats.ts convention: the claimed hostname matches a
 * server row's `hostname` OR `name`, across ALL orgs (the same machine has
 * one bootstrap row per org). Unknown hostname ⇒ accepted-but-unmatched (202
 * semantics): registration stays an explicit UI act, no ghost rows — but the
 * agent shouldn't retry-loop on it.
 *
 * Reports also backfill capacity (cpuTotal/memTotalGb) onto matched rows that
 * still carry the zero placeholder from the join flow — the self-registration
 * the server contract reserved.
 *
 * ── Auth: two schemes, one transition (od-5j8.20) ───────────────────────────
 * Every new agent process registers via `POST /api/agent/register`
 * (agent-register.ts) and presents the resulting SESSION credential here —
 * bound to exactly one (serverId, hostname), so a captured credential can't
 * be replayed to attribute a report to a different node, and it's revoked
 * immediately on node removal (agent-credential.ts). A pre-v2 agent task
 * (still running an image minted before this shipped) has no session
 * credential to present — it sends the OLD shared, swarm-wide bearer
 * instead, so that path is tried first and, if it doesn't parse as a
 * session credential at all, falls back to the legacy verifier. Both are
 * logged distinctly so operators can watch legacy usage taper to zero as the
 * reconciler cycles every node onto the new image.
 */
import { db } from "@otterdeploy/db";
import { server, serverHealthSample } from "@otterdeploy/db/schema/server";
import { and, eq, or } from "drizzle-orm";
import { log } from "evlog";
import * as z from "zod";

import { parseSessionCredential, verifySessionCredential } from "./agent-credential";
import { verifyAgentToken } from "./agent-token";

// Payload validation is deliberately shallow: `health` is the HostHealth
// shape but agents may run a newer/older image than the control plane, so we
// pin only what attribution and staleness need and store the rest as-is.
const reportSchema = z.looseObject({
  hostname: z.string().min(1),
  health: z.looseObject({
    memory: z.looseObject({ totalBytes: z.number() }),
    sampledAt: z.string().min(1),
  }),
  capacity: z
    .object({ cpuTotal: z.number().int().nonnegative(), memTotalGb: z.number().nonnegative() })
    .nullable()
    .optional(),
});

export type AgentHealthReport = z.infer<typeof reportSchema>;

/** Structural write shape — what recordHealthSample actually needs. Both the
 *  parsed ingest payload and a locally-sampled HostHealth satisfy it. */
export interface HealthSampleWrite {
  hostname: string;
  health: { memory: { totalBytes: number }; sampledAt: string };
  capacity?: { cpuTotal: number; memTotalGb: number } | null;
}

type ServerRow = typeof server.$inferSelect;

/** Upsert the latest snapshot for each matched row + backfill placeholder
 *  capacity. Shared by the ingest route and the local sampler. */
export async function recordHealthSample(
  rows: Array<Pick<ServerRow, "id" | "organizationId" | "cpuTotal" | "memTotalGb">>,
  report: HealthSampleWrite,
): Promise<void> {
  const sampledAtDate = new Date(report.health.sampledAt);
  const sampledAt = Number.isNaN(sampledAtDate.getTime()) ? new Date() : sampledAtDate;

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

    // Self-registration: fill capacity only where the join flow left zeros —
    // an operator-entered value is never overwritten by an agent.
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
export async function matchServersByHostname(hostname: string) {
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

/** Look up the one row a session credential is bound to — org-scoped by
 *  construction (the credential itself carries the organizationId). */
async function getServerForSession(serverId: ServerId, organizationId: OrganizationId) {
  const [row] = await db
    .select({
      id: server.id,
      organizationId: server.organizationId,
      cpuTotal: server.cpuTotal,
      memTotalGb: server.memTotalGb,
    })
    .from(server)
    .where(and(eq(server.id, serverId), eq(server.organizationId, organizationId)))
    .limit(1);
  return row;
}

/**
 * POST /api/agent/health — body = AgentHealthReport. Two accepted bearer
 * shapes, tried in order (see the module note above): a session credential
 * (od-5j8.20, the only thing a current-image agent ever sends) bound to one
 * (serverId, hostname), or — transition support only — the legacy swarm-wide
 * bearer a not-yet-recreated agent task may still be holding.
 */
export async function agentHealthIngestHandler(c: Context): Promise<Response> {
  const auth = c.req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!token) return c.json({ error: "missing bearer token" }, 401);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid report shape" }, 400);

  if (parseSessionCredential(token)) {
    const session = await verifySessionCredential(token);
    if (!session) return c.json({ error: "invalid, expired, or revoked agent credential" }, 401);
    // The core od-5j8.20 fix: a credential minted for one node cannot be
    // replayed to attribute a report to a different hostname.
    if (session.hostname !== parsed.data.hostname) {
      log.warn({
        healthAgent: {
          event: "hostname-claim-mismatch",
          boundHostname: session.hostname,
          claimedHostname: parsed.data.hostname,
        },
      });
      return c.json({ error: "hostname claim does not match the credential's bound hostname" }, 403);
    }
    const row = await getServerForSession(session.serverId, session.organizationId);
    if (!row) return c.json({ ok: true, matched: 0 }, 202);
    await recordHealthSample([row], parsed.data);
    return c.json({ ok: true, matched: 1 });
  }

  if (!(await verifyAgentToken(token))) {
    return c.json({ error: "invalid agent token" }, 401);
  }
  log.warn({ healthAgent: { event: "legacy-bearer-used", hostname: parsed.data.hostname } });

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
