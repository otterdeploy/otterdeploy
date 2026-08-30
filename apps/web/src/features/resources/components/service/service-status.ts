/**
 * Pause facts for the service panel.
 *
 * Pause is an explicit operator action recorded as `pausedReplicas` on the
 * service row: it is NOT inferred from "0 replicas" or "no container", so a
 * service someone manually scaled to zero still reads as stopped/scaled-down,
 * never falsely as paused (and a paused one never reads as crashed).
 *
 * Deriving the panel's STATE moved to `resources/lib/resource-state.ts`
 * (`serviceState`), which is the one place any status is decided now.
 */

export function isServicePaused(service: { pausedReplicas: number | null }): boolean {
  return service.pausedReplicas != null;
}

/**
 * The status-bar replica line. Paused explains itself (and what resume
 * restores); otherwise the desired count, including an honest "0 desired
 * replicas" for a service scaled to zero without pausing.
 */
export function replicaSummary(input: { replicas: number; pausedReplicas: number | null }): string {
  if (input.pausedReplicas != null) {
    const n = input.pausedReplicas;
    return `Paused. ${n} replica${n === 1 ? "" : "s"} restored on resume`;
  }
  const n = input.replicas;
  return `${n} desired replica${n === 1 ? "" : "s"}`;
}
