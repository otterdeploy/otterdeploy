/**
 * One row of the four-step install list, shared by both ways in. Command:
 * created, ran, Docker, connected. SSH: connected over SSH, checked, Docker,
 * connected. Only steps the control plane can observe; nothing is invented in
 * between.
 */

export type InstallStepState = "pending" | "active" | "done" | "failed";

export interface InstallStep {
  key: string;
  label: string;
  state: InstallStepState;
  /** When the step finished, as `m:ss` since the run began. Null until done. */
  at: string | null;
}

/** `m:ss` for a span: the install list's times and the command's expiry. */
export function clockSpan(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
