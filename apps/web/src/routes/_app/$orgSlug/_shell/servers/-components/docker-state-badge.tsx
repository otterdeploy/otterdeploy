/**
 * Tone-tinted state badge for the Docker inventory tables.
 *
 * Split out of `docker-panel.tsx`, which is the paginated table SHELL and had
 * accreted this unrelated presentational bit.
 */

import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";

import { type StateTone } from "./docker-format";

const TONE_CLASS: Record<StateTone, string> = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  info: "bg-info/10 text-info",
  destructive: "bg-destructive/10 text-destructive",
  muted: "bg-secondary text-secondary-foreground",
};

/**
 * Tone-tinted state badge (State-Tint Rule: low-opacity tint of its own hue +
 * same-hue text + a leading dot so state never rides on color alone). `label`
 * lets the containers table show the full daemon status line ("Up 4 minutes
 * (healthy)", "Exited (137) 1 hour ago") while `state` drives the tone.
 */
export function StateBadge({
  state,
  tone,
  label,
  title,
}: {
  state: string;
  tone?: StateTone;
  label?: string;
  title?: string;
}) {
  const resolved = tone ?? defaultTone(state);
  return (
    <Badge variant="secondary" className={cn("gap-1.5", TONE_CLASS[resolved])} title={title}>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current opacity-80" />
      {label || state || "–"}
    </Badge>
  );
}

function defaultTone(state: string): StateTone {
  const s = state.toLowerCase();
  if (s === "running") return "success";
  if (s === "exited" || s === "dead" || s === "failed" || s === "rejected") return "destructive";
  if (s === "restarting") return "warning";
  if (s === "paused") return "info";
  return "muted";
}
