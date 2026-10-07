/**
 * Resource-limit and restart-policy field diffs for the manifest diff. Split
 * out of diff-helpers.ts (file-length cap); internal to the diff.
 *
 * Both mirror what apply writes, field for field, because a gate that diffs
 * but does not apply (or the reverse) is a change that either never lands or
 * re-stages forever:
 *   - a declared `resources` block REPLACES every limit (buildResourcesPatch
 *     writes each key, an omitted one as null = no limit), so each compares
 *     against null when omitted;
 *   - `restart.condition` is required whenever `restart` is declared, and the
 *     other restart fields are declared-only: apply leaves an omitted one
 *     alone (toRestartUpdateColumns).
 *
 * CPU/memory limits and reservations, and the restart condition,
 * attempt cap and delay, were not compared at all, so changing one on an
 * existing service staged nothing and never reached the container. The
 * restart window read an omitted value as null, a phantom apply never cleared.
 */
import type { CurrentService } from "./diff";
import type { FieldChanges } from "./diff-source";
import type { ServiceManifest } from "./schema";

type DeclaredResources = NonNullable<ServiceManifest["resources"]>;

type LimitField =
  | "cpuLimit"
  | "memoryLimitMb"
  | "cpuReservation"
  | "memoryReservationMb"
  | "diskLimitMb"
  | "swapLimitMb"
  | "pidsLimit";

/** Decimal places `service_resource.cpu_limit` / `cpu_reservation` keep
 *  (numeric(4,2)): a declared 0.333 is stored as 0.33. */
const CPU_DECIMALS = 2;

/** Cores as the column stores them, so a declared value matches its row. */
function storedCpu(cores: number | undefined): number | null {
  if (cores === undefined) return null;
  const scale = 10 ** CPU_DECIMALS;
  return Math.round(cores * scale) / scale;
}

/** Each live limit, and the value a declared block sets it to. */
const RESOURCE_LIMITS: ReadonlyArray<
  readonly [LimitField, (declared: DeclaredResources) => number | null]
> = [
  ["cpuLimit", (r) => storedCpu(r.cpuLimit)],
  ["memoryLimitMb", (r) => r.memoryMb ?? null],
  ["cpuReservation", (r) => storedCpu(r.cpuReservation)],
  ["memoryReservationMb", (r) => r.memoryReservationMb ?? null],
  ["diskLimitMb", (r) => r.diskMb ?? null],
  ["swapLimitMb", (r) => r.swapMb ?? null],
  ["pidsLimit", (r) => r.pidsLimit ?? null],
];

export function diffResourceLimitFields(
  desired: ServiceManifest,
  current: CurrentService,
  fc: FieldChanges,
): void {
  if (desired.resources === undefined) return;
  for (const [field, declaredValue] of RESOURCE_LIMITS) {
    const to = declaredValue(desired.resources);
    if (to !== current[field]) fc[field] = { from: current[field], to };
  }
}

export function diffRestartFields(
  desired: ServiceManifest,
  current: CurrentService,
  fc: FieldChanges,
): void {
  const restart = desired.restart;
  if (restart === undefined) return;
  if (restart.condition !== current.restartCondition) {
    fc.restartCondition = { from: current.restartCondition, to: restart.condition };
  }
  if (restart.maxAttempts !== undefined && restart.maxAttempts !== current.restartMaxAttempts) {
    fc.restartMaxAttempts = { from: current.restartMaxAttempts, to: restart.maxAttempts };
  }
  if (restart.delayMs !== undefined && restart.delayMs !== current.restartDelayMs) {
    fc.restartDelayMs = { from: current.restartDelayMs, to: restart.delayMs };
  }
  if (restart.windowMs !== undefined && restart.windowMs !== current.restartWindowMs) {
    fc.restartWindowMs = { from: current.restartWindowMs, to: restart.windowMs };
  }
}
