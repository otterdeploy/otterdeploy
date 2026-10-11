/**
 * The summary under the filters: what window and filters it describes, then
 * label-and-value pairs ("Deploys 26 · Failed 3 · Median took 58s"), values in
 * Geist Mono. It recomputes with every filter except the status view, so the
 * figures hold still while you flip between All, Live now and Failed.
 */

import { formatDuration } from "@/shared/lib/duration";

import type { ProjectDeploymentStats } from "../data/deployments-search";

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span>{label}</span>
      <span className="font-mono text-[12px] text-foreground tabular-nums">{value}</span>
    </span>
  );
}

function Dot() {
  return (
    <span aria-hidden className="mx-2.5 text-muted-foreground/50">
      ·
    </span>
  );
}

export function DeploymentsSummary({
  scope,
  stats,
}: {
  /** "Last 7 days", plus the resource, people and search when set. */
  scope: string;
  stats: ProjectDeploymentStats;
}) {
  return (
    <p
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground"
    >
      <span className="font-medium text-foreground max-sm:basis-full">{scope}</span>
      <span className="inline-flex flex-wrap items-baseline">
        <Pair label="Deploys" value={String(stats.windowTotal)} />
        <Dot />
        <Pair label="Failed" value={String(stats.failed)} />
        <Dot />
        <Pair
          label="Median took"
          value={stats.medianDurationMs === null ? "–" : formatDuration(stats.medianDurationMs)}
        />
      </span>
    </p>
  );
}
