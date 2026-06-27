import type { StatusBadge } from "./logs-toolbar";

export type LogStreamStatus = "connecting" | "live" | "ended" | "error";

/** Maps the live-stream status (and the operator's pause) to a toolbar badge. */
export function statusBadge(status: LogStreamStatus, paused: boolean): StatusBadge {
  // Paused overrides any stream status — operator explicitly stopped the tail.
  if (paused) {
    return {
      label: "paused",
      dot: "bg-muted-foreground/50",
      tone: "bg-muted text-muted-foreground",
    };
  }
  switch (status) {
    case "live":
      return {
        label: "live tail",
        dot: "bg-success animate-pulse",
        tone: "bg-success/12 text-success",
      };
    case "connecting":
      return {
        label: "connecting",
        dot: "bg-warning animate-pulse",
        tone: "bg-warning/12 text-warning",
      };
    case "ended":
      return {
        label: "ended",
        dot: "bg-muted-foreground/50",
        tone: "bg-muted text-muted-foreground",
      };
    case "error":
      return {
        label: "error",
        dot: "bg-destructive",
        tone: "bg-destructive/12 text-destructive",
      };
  }
}
