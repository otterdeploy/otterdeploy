/**
 * The freshness-sweep boundary for `server_unit`.
 *
 * This is the whole mechanism by which a unit an operator removed from a host
 * disappears from the UI: nothing diffs reports, nothing reconciles, the row
 * simply stops being touched and ages past the cutoff. Getting the boundary
 * wrong in either direction is a real bug (too tight blanks a healthy host on
 * one missed report; too loose leaves ghosts), so it is pinned here rather
 * than left to the delete predicate in the cron job.
 */
import {
  SERVER_UNIT_STALE_AFTER_MS,
  serverUnitStaleCutoff,
} from "@otterdeploy/db/schema/server-unit";
import { describe, expect, it } from "vite-plus/test";

import { HEALTH_SAMPLE_INTERVAL_MS } from "../agent-ingest";

const NOW = new Date("2026-08-21T12:00:00.000Z");

/** The cron's predicate: `lt(updatedAt, cutoff)`. */
const isSwept = (updatedAt: Date, now: Date) =>
  updatedAt.getTime() < serverUnitStaleCutoff(now).getTime();

describe("serverUnitStaleCutoff", () => {
  it("is five report intervals back, not an arbitrary duration", () => {
    // Tied to the agent's cadence, so changing the report interval cannot
    // silently leave the sweep sitting at the wrong multiple of it.
    expect(SERVER_UNIT_STALE_AFTER_MS).toBe(HEALTH_SAMPLE_INTERVAL_MS * 5);
    expect(serverUnitStaleCutoff(NOW).toISOString()).toBe("2026-08-21T11:55:00.000Z");
  });

  it("keeps a unit that reported one interval ago", () => {
    const updated = new Date(NOW.getTime() - HEALTH_SAMPLE_INTERVAL_MS);
    expect(isSwept(updated, NOW)).toBe(false);
  });

  it("survives several missed reports rather than blanking the host", () => {
    // An agent restart or a control-plane deploy costs a couple of reports.
    const updated = new Date(NOW.getTime() - HEALTH_SAMPLE_INTERVAL_MS * 4);
    expect(isSwept(updated, NOW)).toBe(false);
  });

  it("a row exactly at the cutoff is kept; one millisecond older is swept", () => {
    const exactly = new Date(NOW.getTime() - SERVER_UNIT_STALE_AFTER_MS);
    expect(isSwept(exactly, NOW)).toBe(false);
    expect(isSwept(new Date(exactly.getTime() - 1), NOW)).toBe(true);
  });

  it("sweeps a unit the host stopped reporting", () => {
    const removed = new Date(NOW.getTime() - HEALTH_SAMPLE_INTERVAL_MS * 10);
    expect(isSwept(removed, NOW)).toBe(true);
  });

  it("a unit reads as stale BEFORE it vanishes", () => {
    // The read path flags stale at 3 intervals; the sweep deletes at 5. If the
    // sweep were the tighter of the two, rows would disappear without ever
    // having been shown as doubtful.
    const readStaleAfterMs = HEALTH_SAMPLE_INTERVAL_MS * 3;
    expect(readStaleAfterMs).toBeLessThan(SERVER_UNIT_STALE_AFTER_MS);

    const between = new Date(NOW.getTime() - HEALTH_SAMPLE_INTERVAL_MS * 4);
    expect(NOW.getTime() - between.getTime()).toBeGreaterThan(readStaleAfterMs);
    expect(isSwept(between, NOW)).toBe(false);
  });
});
