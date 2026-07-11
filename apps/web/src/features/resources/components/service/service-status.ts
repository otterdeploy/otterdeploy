/**
 * Pure state-derivation helpers for the service panel's status surfaces
 * (status bar, Overview stat tiles, header pause/resume action).
 *
 * Pause is an explicit operator action recorded as `pausedReplicas` on the
 * service row — it is NOT inferred from "0 replicas" or "no container", so a
 * service someone manually scaled to zero still reads as stopped/scaled-down,
 * never falsely as paused (and a paused one never reads as crashed).
 */

/** Runtime status as reported by the runtime driver (`service.get`). */
export type ServiceRuntimeStatus = "running" | "starting" | "stopped" | "missing" | "error";

/** What the panel presents. `paused` overrides the raw runtime status —
 *  a paused service's container is gone on purpose. `unknown` = the live
 *  service view hasn't loaded (never guess a state). */
export type ServicePanelState = ServiceRuntimeStatus | "paused" | "unknown";

export function isServicePaused(service: { pausedReplicas: number | null }): boolean {
  return service.pausedReplicas != null;
}

export function deriveServicePanelState(input: {
  /** Non-null = paused; the count resume restores. */
  pausedReplicas: number | null;
  /** Live runtime status; undefined/null while `service.get` is loading. */
  runtimeStatus: ServiceRuntimeStatus | null | undefined;
}): ServicePanelState {
  if (input.pausedReplicas != null) return "paused";
  if (input.runtimeStatus == null) return "unknown";
  return input.runtimeStatus;
}

/**
 * The status-bar replica line. Paused explains itself (and what resume
 * restores); otherwise the desired count — including an honest "0 desired
 * replicas" for a service scaled to zero without pausing.
 */
export function replicaSummary(input: { replicas: number; pausedReplicas: number | null }): string {
  if (input.pausedReplicas != null) {
    const n = input.pausedReplicas;
    return `Paused — ${n} replica${n === 1 ? "" : "s"} restored on resume`;
  }
  const n = input.replicas;
  return `${n} desired replica${n === 1 ? "" : "s"}`;
}

/** Human label per panel state — shared by the status bar and Overview tile. */
export const PANEL_STATE_LABEL: Record<ServicePanelState, string> = {
  running: "running",
  starting: "starting",
  stopped: "stopped",
  missing: "not running",
  error: "error",
  paused: "paused",
  unknown: "—",
};
