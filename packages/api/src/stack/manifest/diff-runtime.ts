/**
 * Restart-policy and healthcheck comparison for the manifest diff.
 *
 * Split out of diff-helpers.ts the way `routers/service/inputs.ts` splits its
 * adapters into cohesive column groups: the field mapping here is wide, and
 * keeping it beside the exec/resource diffs pushed that file past its size cap.
 *
 * These two blocks use OPPOSITE conventions for an omitted sub-field, and both
 * are correct, because each mirrors what apply actually writes. Getting this
 * backwards in either direction is a real bug with a visible symptom:
 *
 *   - too eager -> the diff stages a change apply will not make, and reports it
 *     again on every diff: the permanently stuck pending-changes bar.
 *   - too lax   -> apply writes a field the diff never reported, so drift is
 *     invisible and lands later as a side effect of an unrelated change.
 */
import type { CurrentService } from "./diff";
import type { ServiceManifest } from "./schema";

import { type FieldChanges } from "./diff-source";

/** Array equality that treats a missing list and an empty one as different,
 *  matching how the columns store them. */
function sameCommand(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Restart policy, DECLARED-ONLY.
 *
 * Apply passes `restart: spec.restart` straight through, and
 * `toRestartUpdateColumns` reads each sub-field as `restart?.x` — an omitted one
 * arrives as `undefined`, is stripped by omitUndefined, and the column is left
 * alone. This mirrors that exactly.
 *
 * It previously compared `windowMs ?? null`, so a manifest declaring
 * `restart: { condition }` against a service with a live window staged a change
 * to null that apply then refused to make, and which came back on the next diff
 * forever. The other three sub-fields were not compared at all.
 *
 * `maxAttempts` is nullable in the schema, so an EXPLICIT null is an instruction
 * ("no cap") and has to be told apart from omission — hence `in` rather than a
 * `!== undefined` check.
 */
export function diffRestart(
  restart: NonNullable<ServiceManifest["restart"]>,
  current: CurrentService,
  fc: FieldChanges,
): void {
  if (restart.condition !== current.restartCondition) {
    fc.restartCondition = { from: current.restartCondition, to: restart.condition };
  }
  if ("maxAttempts" in restart) {
    const desired = restart.maxAttempts ?? null;
    if (desired !== current.restartMaxAttempts) {
      fc.restartMaxAttempts = { from: current.restartMaxAttempts, to: desired };
    }
  }
  if (restart.delayMs !== undefined && restart.delayMs !== current.restartDelayMs) {
    fc.restartDelayMs = { from: current.restartDelayMs, to: restart.delayMs };
  }
  if (restart.windowMs !== undefined && restart.windowMs !== current.restartWindowMs) {
    fc.restartWindowMs = { from: current.restartWindowMs, to: restart.windowMs };
  }
}

/**
 * Healthcheck. Unlike restart, declaring the block IS authoritative over all of
 * it: `buildHealthcheckPatch` writes `?? null` for every optional sub-field, so
 * omitting one clears it. Comparing with `?? null` is what matches apply — the
 * opposite convention to {@link diffRestart}, for the opposite reason.
 *
 * The whole block used to be absent from the diff AND from `CurrentService`, so
 * editing a healthcheck produced no pending change at all, and then took effect
 * on the next apply triggered by something else.
 */
export function diffHealthcheck(
  desired: ServiceManifest,
  current: CurrentService,
  fc: FieldChanges,
): void {
  // Nullable in the schema, and `buildHealthcheckPatch` maps both `undefined`
  // and an explicit `null` to `undefined` (leave the columns alone). So skip
  // both: a manifest cannot clear a healthcheck, and the diff must not promise
  // that it can.
  const hc = desired.healthcheck;
  if (!hc) return;

  if (!sameCommand(hc.cmd, current.healthcheckCmd)) {
    fc.healthcheckCmd = { from: current.healthcheckCmd, to: hc.cmd };
  }
  const scalars: Array<[keyof FieldChanges, number | null, number | null]> = [
    ["healthcheckIntervalMs", hc.intervalMs ?? null, current.healthcheckIntervalMs],
    ["healthcheckTimeoutMs", hc.timeoutMs ?? null, current.healthcheckTimeoutMs],
    ["healthcheckRetries", hc.retries ?? null, current.healthcheckRetries],
    ["healthcheckStartMs", hc.startMs ?? null, current.healthcheckStartMs],
  ];
  for (const [key, want, have] of scalars) {
    if (want !== have) fc[key] = { from: have, to: want };
  }
}
