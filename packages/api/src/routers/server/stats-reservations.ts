/**
 * Type-safe nibbles into the loosely-typed Task.Spec blob from the docker SDK.
 * `in`-guarded hops instead of shape assertions: each level is actually
 * checked before it is read. Split out of stats.ts, which owns the
 * aggregation these feed.
 */

function taskReservations(spec: unknown): unknown {
  if (typeof spec !== "object" || spec === null || !("Resources" in spec)) return undefined;
  const resources = spec.Resources;
  if (typeof resources !== "object" || resources === null || !("Reservations" in resources)) {
    return undefined;
  }
  return resources.Reservations;
}

export function readNanoCpus(spec: unknown): number {
  const reservations = taskReservations(spec);
  if (typeof reservations !== "object" || reservations === null || !("NanoCPUs" in reservations)) {
    return 0;
  }
  return typeof reservations.NanoCPUs === "number" ? reservations.NanoCPUs : 0;
}

export function readMemoryBytes(spec: unknown): number {
  const reservations = taskReservations(spec);
  if (
    typeof reservations !== "object" ||
    reservations === null ||
    !("MemoryBytes" in reservations)
  ) {
    return 0;
  }
  return typeof reservations.MemoryBytes === "number" ? reservations.MemoryBytes : 0;
}
