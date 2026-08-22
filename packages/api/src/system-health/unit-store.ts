/**
 * The write side of `server_unit`: the collector's reading for a host, landed
 * against every server row that host matched.
 *
 * Shaped like recordHealthSample in agent-ingest.ts on purpose. Callers hand
 * over the already-matched rows (hostname → server, across orgs, because the
 * same machine has one bootstrap row per org) and the parsed section; this
 * module owns nothing but the SQL.
 *
 * Upsert-many, never append: `server_unit` keeps the latest row per unit, so
 * a report is one INSERT … ON CONFLICT per server, not one per unit. Rows for
 * units that stopped being reported are not deleted here; they age out
 * through the freshness sweep in the hourly cleanup, which is what lets a
 * removed unit disappear with no reconcile step.
 */
import { db } from "@otterdeploy/db";
import { serverUnit } from "@otterdeploy/db/schema/server-unit";
import { Result } from "better-result";
import { sql } from "drizzle-orm";
import { log } from "evlog";

import type { SystemdUnit } from "./systemd";

type ServerRow = typeof serverUnit.$inferSelect;

/** Values-array chunk per statement: a host with 400 units × 10 columns is
 *  4,000 bind parameters, and Postgres' limit is 65,535. */
const UPSERT_CHUNK = 200;

/**
 * Land one host's units against the server rows it matched.
 *
 * Best-effort per the host-health discipline: a failed write is logged and
 * dropped rather than thrown, because this rides the same ingest request as
 * the health sample and a units hiccup must not reject the whole report.
 * The next report is 60 seconds away and carries the same state.
 */
export async function recordServerUnits(
  rows: Array<Pick<ServerRow, "serverId" | "organizationId">>,
  units: SystemdUnit[],
  now: Date = new Date(),
): Promise<void> {
  if (rows.length === 0 || units.length === 0) return;

  for (const row of rows) {
    const values = units.map((unit) => ({
      serverId: row.serverId,
      organizationId: row.organizationId,
      unitName: unit.name,
      activeState: unit.activeState,
      subState: unit.subState,
      cpuPct: unit.cpuPct,
      memBytes: unit.memBytes,
      memPeakBytes: unit.memPeakBytes,
      restartCount: unit.restartCount,
      activeEnterAt: unit.activeEnterTimestamp ? new Date(unit.activeEnterTimestamp) : null,
      updatedAt: now,
    }));

    for (let i = 0; i < values.length; i += UPSERT_CHUNK) {
      const chunk = values.slice(i, i + UPSERT_CHUNK);
      const written = await Result.tryPromise({
        try: () =>
          db
            .insert(serverUnit)
            .values(chunk)
            .onConflictDoUpdate({
              target: [serverUnit.serverId, serverUnit.unitName],
              // Full-set last-write-wins: a partial set would freeze the
              // omitted columns at whatever the row was first created with.
              set: {
                activeState: sql`excluded.active_state`,
                subState: sql`excluded.sub_state`,
                cpuPct: sql`excluded.cpu_pct`,
                memBytes: sql`excluded.mem_bytes`,
                memPeakBytes: sql`excluded.mem_peak_bytes`,
                restartCount: sql`excluded.restart_count`,
                activeEnterAt: sql`excluded.active_enter_at`,
                updatedAt: sql`excluded.updated_at`,
              },
            }),
        catch: (cause) => cause,
      });
      if (written.isErr()) {
        log.warn({
          serverUnits: { event: "upsert-failed", serverId: row.serverId, count: chunk.length },
          error: written.error instanceof Error ? written.error.message : String(written.error),
        });
        break;
      }
    }
  }
}
