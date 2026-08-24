/**
 * Per-server systemd unit read: the latest `server_unit` rows for one server,
 * org-scoped.
 *
 * Scoped by (server, org) in the WHERE clause rather than by looking the
 * server up first: an id belonging to another org returns an empty list, the
 * same shape a server with no reporting agent returns, so the read leaks
 * nothing about whether the id exists.
 *
 * `activeState`/`subState` are stored as plain text (the vocabulary is the
 * reporting host's systemd version, not ours) and re-parsed here against the
 * current union: a value written by a newer collector degrades to "unknown"
 * for that row instead of failing the whole list. Same discipline as
 * health.ts re-validating its stored HostHealth payload.
 */
import type { ServerId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { serverUnit } from "@otterdeploy/db/schema/server-unit";
import { and, asc, eq } from "drizzle-orm";

import type { UnitActiveState, UnitSubState } from "../../system-health/systemd";

import { HEALTH_SAMPLE_INTERVAL_MS } from "../../system-health/agent-ingest";
import { parseActiveState, parseSubState } from "../../system-health/systemd";

/** Same window health.ts uses: three missed reports and the row is doubted.
 *  Note this is SHORTER than the sweep's retention, so a unit spends a while
 *  visibly stale before it disappears, rather than vanishing without warning. */
const STALE_AFTER_MS = HEALTH_SAMPLE_INTERVAL_MS * 3;

export interface ServerUnitEntry {
  unitName: string;
  activeState: UnitActiveState;
  subState: UnitSubState;
  cpuPct: number;
  memBytes: number | null;
  memPeakBytes: number | null;
  restartCount: number;
  activeEnterAt: string | null;
  updatedAt: string;
  /** Last report older than 3× the sample interval: the host went quiet. */
  stale: boolean;
}

export async function getServerUnits(input: {
  organizationId: string;
  serverId: ServerId;
}): Promise<ServerUnitEntry[]> {
  const rows = await db
    .select()
    .from(serverUnit)
    .where(
      and(
        eq(serverUnit.serverId, input.serverId),
        eq(serverUnit.organizationId, input.organizationId),
      ),
    )
    .orderBy(asc(serverUnit.unitName));

  const now = Date.now();
  return rows.map((row) => ({
    unitName: row.unitName,
    activeState: parseActiveState(row.activeState),
    subState: parseSubState(row.subState),
    cpuPct: row.cpuPct,
    memBytes: row.memBytes,
    memPeakBytes: row.memPeakBytes,
    restartCount: row.restartCount,
    activeEnterAt: row.activeEnterAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    stale: now - row.updatedAt.getTime() > STALE_AFTER_MS,
  }));
}
