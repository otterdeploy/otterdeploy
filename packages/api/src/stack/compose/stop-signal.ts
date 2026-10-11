/** Compose `stop_grace_period` / `stop_signal` normalization. */

import type { ParsedComposeService } from "./types";

/** The service's `stop_grace_period` as written and its normalized `stop_signal`. */
export function normalizeStop(svc: {
  stop_grace_period?: unknown;
  stop_signal?: unknown;
}): Pick<ParsedComposeService, "stopGracePeriod" | "stopSignal"> {
  const period = svc.stop_grace_period;
  return {
    stopGracePeriod: typeof period === "string" && period.trim() ? period.trim() : null,
    stopSignal: normalizeStopSignal(svc.stop_signal),
  };
}

/** `stop_signal`: a signal name (`SIGINT`, `sigquit`) or a number, as docker takes it. */
function normalizeStopSignal(v: unknown): string | null {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return String(v);
  if (typeof v !== "string") return null;
  const name = v.trim().toUpperCase();
  return /^(SIG)?[A-Z0-9]+$/.test(name) ? name : null;
}
