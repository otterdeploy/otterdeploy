/**
 * The healthcheck field of the manifest's service diff. Split out
 * of diff-helpers.ts (line cap); internal to the diff.
 */

import type { CurrentHealthcheck, CurrentService } from "./diff";
import type { FieldChanges } from "./diff-source";
import type { ServiceManifest } from "./schema";

/** The healthcheck exactly as apply stores it (`buildHealthcheckPatch`):
 *  omitted timings are null, so a declared block compares against the row
 *  field for field. */
function declaredHealthcheck(
  healthcheck: NonNullable<ServiceManifest["healthcheck"]>,
): CurrentHealthcheck {
  return {
    cmd: healthcheck.cmd,
    intervalMs: healthcheck.intervalMs ?? null,
    timeoutMs: healthcheck.timeoutMs ?? null,
    retries: healthcheck.retries ?? null,
    startMs: healthcheck.startMs ?? null,
  };
}

function sameHealthcheck(a: CurrentHealthcheck | null, b: CurrentHealthcheck | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.cmd.length === b.cmd.length &&
    a.cmd.every((v, i) => v === b.cmd[i]) &&
    a.intervalMs === b.intervalMs &&
    a.timeoutMs === b.timeoutMs &&
    a.retries === b.retries &&
    a.startMs === b.startMs
  );
}

/** Declared-only, like every field here: an omitted `healthcheck` key is
 *  live-managed. A declared one that differs from the row is an update, so a
 *  healthcheck added to an EXISTING service reaches the container. `null` declares "no healthcheck". */
export function diffHealthcheck(
  desired: ServiceManifest,
  current: CurrentService,
  fc: FieldChanges,
): void {
  if (desired.healthcheck === undefined) return;
  const want = desired.healthcheck === null ? null : declaredHealthcheck(desired.healthcheck);
  const have = current.healthcheck ?? null;
  if (!sameHealthcheck(want, have)) fc.healthcheck = { from: have, to: want };
}
