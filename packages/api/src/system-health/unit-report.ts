/**
 * The wire shape of the `units` section of a health report: the boundary
 * between what a remote agent claims and what this process will store.
 *
 * Kept DB-free and separate from unit-store.ts so the ingest route can parse
 * without pulling the client, and so it is testable without a database.
 *
 * Tolerant by design, matching the shallow validation agent-ingest.ts already
 * applies to `health`: agents run a newer or older image than the control
 * plane across an upgrade, so a field this version does not recognise falls
 * back rather than rejecting the whole report. `name` is the exception, since
 * a unit with no name has no identity and nothing to key a row on.
 */
import * as z from "zod";

import { UNIT_ACTIVE_STATES, UNIT_SUB_STATES } from "./systemd-parse";

/** Matches the collector's MAX_UNITS: a report claiming more is malformed. */
const MAX_REPORTED_UNITS = 400;

export const systemdUnitSchema = z.object({
  name: z.string().min(1),
  activeState: z.enum(UNIT_ACTIVE_STATES).catch("unknown"),
  subState: z.enum(UNIT_SUB_STATES).catch("unknown"),
  cpuPct: z.number().min(0).max(100).catch(0),
  // Null is a real value here ("this host has no accounting for that unit"),
  // never a stand-in for a number we failed to read.
  memBytes: z.number().nonnegative().nullable().catch(null),
  memPeakBytes: z.number().nonnegative().nullable().catch(null),
  restartCount: z.number().int().nonnegative().catch(0),
  activeEnterTimestamp: z.string().nullable().catch(null),
});

export const systemdSectionSchema = z.object({
  units: z.array(systemdUnitSchema).max(MAX_REPORTED_UNITS),
  sampledAt: z.string().min(1),
});

/** `null` is the honest answer from a host with no systemd, so the section is
 *  nullable AND optional: an older agent omits the key entirely. */
export const systemdReportField = systemdSectionSchema.nullable().optional();
