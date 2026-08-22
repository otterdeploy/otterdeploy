/**
 * Per-host systemd unit status: one row per (server, unit), holding the
 * LATEST reading. Written from the health report (see the collector in
 * packages/api/src/system-health/systemd.ts).
 *
 * A STATUS SURFACE, NOT A TIME SERIES. That is the whole design decision.
 * A typical host runs 60–150 service units and reports every 60s; keeping
 * history would be ~2M rows per host per year for data nobody scrubs back
 * through, and the question an operator actually asks ("is sshd up on
 * prod-04?") only ever needs the newest answer. Trends stay where trends
 * live: platform_metric and OTel.
 *
 * Rows are therefore UPSERTED in place and never appended, and the table is
 * kept honest by a FRESHNESS SWEEP rather than by any reconcile step: a unit
 * an operator removed from a host simply stops being reported, its row ages
 * past `SERVER_UNIT_STALE_AFTER_MS`, and the hourly cleanup deletes it. The
 * UI shows what the host last said, and nothing it stopped saying.
 *
 * Org-scoped and cascading on server delete, matching server_health_sample.
 */
import type { ServerId } from "@otterdeploy/shared/id";

import {
  bigint,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { server } from "./server";

export const serverUnit = pgTable(
  "server_unit",
  {
    serverId: text("server_id")
      .notNull()
      .$type<ServerId>()
      .references(() => server.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Unescaped unit name ("docker.service"), never systemd's raw `\x2d` form. */
    unitName: text("unit_name").notNull(),
    /**
     * systemd's ActiveState / SubState as plain text, NOT a pg enum.
     *
     * The vocabulary is versioned by the reporting host's systemd, not by
     * this schema: v254 added `dead-before-auto-restart` and friends, and a
     * pg enum would turn "an operator upgraded a box" into a failed INSERT.
     * The closed union lives in the collector and is re-parsed on read, so an
     * unrecognised value degrades to "unknown" instead of dropping the row.
     */
    activeState: text("active_state").notNull(),
    subState: text("sub_state").notNull(),
    /** Percent of one host's worth of CPU (0–100), derived by the collector
     *  from the cumulative CPUUsageNSec counter across two reports. */
    cpuPct: doublePrecision("cpu_pct").notNull().default(0),
    /** Nullable on purpose: systemd reports UINT64_MAX when a unit has no
     *  memory accounting, and "unknown" must not render as a number. */
    memBytes: bigint("mem_bytes", { mode: "number" }),
    memPeakBytes: bigint("mem_peak_bytes", { mode: "number" }),
    restartCount: integer("restart_count").notNull().default(0),
    /** When the unit last entered `active`. Units that have NEVER been active
     *  are not reported at all, so this is null only when the host gave a
     *  timestamp we could not read. */
    activeEnterAt: timestamp("active_enter_at"),
    /** Our clock, not the reporter's: reporter clocks skew, and this column
     *  is what the freshness sweep judges. */
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    // Latest-per-unit, not history: the key IS the identity of the row.
    primaryKey({ columns: [t.serverId, t.unitName] }),
    index("server_unit_org_idx").on(t.organizationId),
    // The freshness sweep's predicate.
    index("server_unit_updated_at_idx").on(t.updatedAt),
  ],
);

export type ServerUnitRow = typeof serverUnit.$inferSelect;
export type NewServerUnitRow = typeof serverUnit.$inferInsert;

/**
 * How long a unit row outlives its last report before the sweep removes it.
 *
 * Five report intervals (the agent reports every
 * HEALTH_SAMPLE_INTERVAL_MS = 60s; see packages/api/src/system-health/
 * agent-ingest.ts). Long enough that a couple of missed reports, an agent
 * restart or a control-plane deploy never blanks a healthy host's unit list;
 * short enough that a unit an operator actually removed disappears from the
 * UI within the hour, with no reconcile step anywhere.
 *
 * Deliberately declared HERE rather than imported from the api package: the
 * sweep runs in @otterdeploy/jobs, which api depends on and so cannot import
 * back. The table's retention window belongs with the table.
 */
export const SERVER_UNIT_STALE_AFTER_MS = 5 * 60_000;

/** Rows with `updatedAt` strictly before this have missed too many reports. */
export function serverUnitStaleCutoff(now: Date): Date {
  return new Date(now.getTime() - SERVER_UNIT_STALE_AFTER_MS);
}
