/**
 * The one place a measured percentage becomes a severity.
 *
 * Shared deliberately between the web client and the API: what the UI paints
 * amber and what the alert evaluator decides to wake someone up for must never
 * be able to disagree. A colour that says "fine" beside an alert that says
 * "critical" destroys trust in both.
 *
 * Levels are operator-owned, not constants. 85% disk is comfortable on a 4 TB
 * archive box and an emergency on a 40 GB build host; picking one number for
 * both is picking the wrong number for one of them.
 */

export type MeterState = "good" | "warn" | "crit";

export interface Thresholds {
  /** Percentage at or above which a value reads as elevated. */
  warn: number;
  /** Percentage at or above which a value reads as critical. */
  crit: number;
}

/** Sensible starting point for a fresh install; every install can change it. */
export const DEFAULT_THRESHOLDS: Thresholds = { warn: 65, crit: 90 };

/**
 * Classify a percentage. `crit` is tested first so a misconfigured pair where
 * `warn > crit` still degrades to "the worse of the two" rather than silently
 * never reporting critical.
 */
export function meterState(value: number, thresholds: Thresholds = DEFAULT_THRESHOLDS): MeterState {
  if (!Number.isFinite(value)) return "good";
  if (value >= thresholds.crit) return "crit";
  if (value >= thresholds.warn) return "warn";
  return "good";
}

/** Clamp an operator's input to a usable pair. `warn` may equal `crit` (a
 *  single hard line) but may never exceed it. */
export function normalizeThresholds(input: Partial<Thresholds>): Thresholds {
  const crit = clampPct(input.crit ?? DEFAULT_THRESHOLDS.crit);
  const warn = Math.min(clampPct(input.warn ?? DEFAULT_THRESHOLDS.warn), crit);
  return { warn, crit };
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_THRESHOLDS.crit;
  return Math.min(100, Math.max(1, Math.round(value)));
}
