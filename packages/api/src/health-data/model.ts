/**
 * Constants and record shapes of the health data plane: retention windows,
 * rollup tiers, probe states and correction-ledger record kinds.
 *
 * Times are integer epoch milliseconds (event time); durations are
 * milliseconds; latencies are microseconds.
 */
import { Temporal } from "@otterdeploy/shared/temporal";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Corrections are accepted for seven days plus a five-minute clock allowance. */
export const REPLAY_HORIZON_MS = 7 * DAY + 5 * MINUTE;
/**
 * Records whose clock uncertainty exceeds this stay diagnostic history and
 * never correct an interval. It also bounds how far back inserting a record
 * can change its predecessor (see `rebuildRange`).
 */
export const MAX_AUTHORITATIVE_UNCERTAINTY_MS = 5 * MINUTE;
/** Live lateness allowance: newer buckets are provisional, and replay yields past it. */
export const LIVE_LATENESS_MS = 5 * MINUTE;
/** Raw payload retention (probe detail, raw metric samples). */
export const RAW_RETENTION_MS = 48 * HOUR;
/** Records further in the future than this (receiver time) are refused. */
export const MAX_FUTURE_MS = HOUR;

export const TIER = { base10m: 1, hour: 2, day: 3 } as const;
type Tier = (typeof TIER)[keyof typeof TIER];
/** Rollup retention per tier. Metrics stop at the hourly tier. */
export const TIER_RETENTION_MS: Record<Tier, number> = { 1: 14 * DAY, 2: 90 * DAY, 3: 400 * DAY };

/** Probe states, in duration-vector order. */
export const STATE = { healthy: 0, degraded: 1, down: 2, unknown: 3 } as const;
export type ProbeState = (typeof STATE)[keyof typeof STATE];

/** Ledger record kinds. Markers carry no state; they cut the predecessor. */
export const KIND = {
  observation: 0,
  tombstone: 1,
  boot: 2,
  gapStart: 3,
  gapEnd: 4,
  maintenanceStart: 5,
  maintenanceEnd: 6,
  /** Uncertainty over the authoritative bound: kept as history, never evaluated. */
  diagnostic: 7,
} as const;
export type RecordKind = (typeof KIND)[keyof typeof KIND];

export const SERIES_KIND = { probe: 1, metric: 2 } as const;
export type SeriesKind = (typeof SERIES_KIND)[keyof typeof SERIES_KIND];

/** One correction-ledger record as the evaluator sees it. */
export interface LedgerRecord {
  t: number;
  /** Boot reference: records of different boots never continue each other. */
  boot: number;
  seq: number;
  kind: RecordKind;
  /** Probe state for observations; ignored for markers and metrics. */
  state: ProbeState;
  uncMs: number;
  ttlMs: number;
  /** Final-round latency (µs) of a successful probe round. */
  latUs: number | null;
  /** Individual attempt latencies (µs) when the round retried. */
  attUs: readonly number[] | null;
  /** Metric values by position; null = not measured this round (never zero). */
  vals: readonly (number | null)[] | null;
}

/**
 * Metric vector width. A sample's named values are stored positionally in the
 * node contract's metric-name order (see ./frames.ts), which must fit.
 */
export const METRIC_WIDTH = 32;

/** DDSketch relative accuracy for latency sketches. */
export const SKETCH_ALPHA = 0.01;

export const floorTo = (t: number, width: number): number => Math.floor(t / width) * width;

/** Current epoch milliseconds. */
export const nowMs = (): number => Temporal.Now.instant().epochMilliseconds;
