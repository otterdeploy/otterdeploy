/**
 * Pure form-state helpers for the health-check card: seeding the form from
 * the stored check, validity, dirtiness, and the saved patch. Split out of
 * `health-check-card.tsx` so the form component stays within the complexity
 * budget — all logic is a verbatim move.
 */

import {
  buildHttpHealthcheckCmd,
  parseHttpHealthcheckCmd,
  type HttpHealthcheck,
} from "./healthcheck-http";

export const HEALTHCHECK_DEFAULTS = { path: "/health", intervalS: 30, timeoutS: 5, retries: 3 };

export interface HealthCheckFormState {
  enabled: boolean;
  path: string;
  intervalS: number;
  timeoutS: number;
  retries: number;
}

/** The stored healthcheck slice of the `service.get` view. */
interface StoredHealthcheck {
  cmd: string[] | null;
  intervalMs: number | null;
  timeoutMs: number | null;
  retries: number | null;
  startMs: number | null;
}

export function initialHealthcheckForm(
  healthcheck: StoredHealthcheck | null | undefined,
): HealthCheckFormState {
  const parsed = parseHttpHealthcheckCmd(healthcheck?.cmd ?? null);
  return {
    enabled: !!healthcheck?.cmd,
    path: parsed?.path ?? HEALTHCHECK_DEFAULTS.path,
    intervalS: Math.round(
      (healthcheck?.intervalMs ?? HEALTHCHECK_DEFAULTS.intervalS * 1000) / 1000,
    ),
    timeoutS: Math.round((healthcheck?.timeoutMs ?? HEALTHCHECK_DEFAULTS.timeoutS * 1000) / 1000),
    retries: healthcheck?.retries ?? HEALTHCHECK_DEFAULTS.retries,
  };
}

/** Probe target: the primary HTTP port, else the first declared port. */
export function probePort(
  ports: readonly { isPrimary: boolean; containerPort: number }[],
): number | null {
  return (ports.find((p) => p.isPrimary) ?? ports[0])?.containerPort ?? null;
}

/** Interval / timeout / retries within their allowed integer ranges. */
export function healthcheckNumbersValid(form: HealthCheckFormState): boolean {
  return (
    Number.isInteger(form.intervalS) &&
    form.intervalS >= 1 &&
    form.intervalS <= 3600 &&
    Number.isInteger(form.timeoutS) &&
    form.timeoutS >= 1 &&
    form.timeoutS <= 600 &&
    Number.isInteger(form.retries) &&
    form.retries >= 0 &&
    form.retries <= 20
  );
}

/** Does the form differ from what's stored (i.e. is there anything to save)? */
export function isHealthcheckDirty({
  form,
  baseline,
  normalizedPath,
  parsedExisting,
  isCustomCmd,
}: {
  form: HealthCheckFormState;
  baseline: HealthCheckFormState;
  normalizedPath: string;
  parsedExisting: HttpHealthcheck | null;
  isCustomCmd: boolean;
}): boolean {
  return (
    form.enabled !== baseline.enabled ||
    (form.enabled &&
      (normalizedPath !== (parsedExisting?.path ?? baseline.path) ||
        form.intervalS !== baseline.intervalS ||
        form.timeoutS !== baseline.timeoutS ||
        form.retries !== baseline.retries ||
        isCustomCmd))
  );
}

/** The `healthcheck` patch `service.update` receives on save. Explicit nulls
 *  clear the stored check (an omitted/null healthcheck object is
 *  patch-semantics "leave alone" server-side). */
export function buildHealthcheckPatch({
  form,
  normalizedPath,
  port,
  existingStartMs,
}: {
  form: HealthCheckFormState;
  normalizedPath: string;
  port: number;
  existingStartMs: number | null | undefined;
}) {
  return form.enabled
    ? {
        cmd: buildHttpHealthcheckCmd({ path: normalizedPath, port }),
        intervalMs: form.intervalS * 1000,
        timeoutMs: form.timeoutS * 1000,
        retries: form.retries,
        startMs: existingStartMs ?? null,
      }
    : { cmd: null, intervalMs: null, timeoutMs: null, retries: null, startMs: null };
}
