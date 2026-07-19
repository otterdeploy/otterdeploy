/**
 * Traffic tab for the bottom stack drawer — one row per public HTTP host in
 * the project (edgeLogs.routeStats): host, owning resource, rps, p95, error
 * rate over a selectable 5m/1h window, polled every 10s. Hosts with no
 * traffic show honest dashes, not zeros dressed up as measurements.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { useState } from "react";

import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { resourceCollection } from "@/features/resources/data/resource";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

type TrafficRange = "5m" | "1h";

/** Same threshold as the edge-logs host footer: >5% errors reads destructive. */
const ERROR_RATE_ALERT = 0.05;

export function TrafficPanel({ projectId }: { projectId: ProjectId }) {
  const [range, setRange] = useState<TrafficRange>("5m");
  const query = useQuery({
    ...orpc.edgeLogs.routeStats.queryOptions({ input: { projectId, range } }),
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  });

  // Owning resource names come from the already-cached resource collection —
  // no second fetch, and the graph keeps this warm.
  const { data: resources } = useLiveQuery(
    (q) => q.from({ r: resourceCollection }).where(({ r }) => eq(r.projectId, projectId)),
    [projectId],
  );
  const nameByResourceId = new Map(resources.map((r) => [r.resourceId as string, r.name]));

  if (query.isLoading) return <TrafficPending />;
  if (query.isError) {
    return <CenterMessage text="Couldn't load traffic stats — retrying on the next refresh." />;
  }

  const rows = query.data ?? [];
  if (rows.length === 0) {
    return (
      <CenterMessage text="No public hosts in this project yet. Expose a service to see its traffic here." />
    );
  }

  const anyTraffic = rows.some((r) => r.rps > 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/40 bg-muted/30 px-4 py-1.5">
        <span className="text-[10px] font-medium tracking-wider text-muted-foreground/70 uppercase">
          Public hosts
        </span>
        {!anyTraffic ? (
          <span className="text-[11px] text-muted-foreground/70">· no requests in this window</span>
        ) : null}
        <div className="ml-auto flex items-center gap-0.5 rounded-md border border-border/40 p-0.5">
          {(["5m", "1h"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className={cn(
                "rounded px-1.5 py-0.5 font-mono text-[10.5px] transition-colors",
                range === r
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex items-center gap-3 border-b border-border/40 px-4 py-1.5 text-[10px] font-medium tracking-wider text-muted-foreground/70 uppercase">
          <span className="min-w-0 flex-[2]">Host</span>
          <span className="min-w-0 flex-1">Service</span>
          <span className="w-16 text-right">rps</span>
          <span className="w-16 text-right">p95</span>
          <span className="w-16 text-right">err</span>
        </div>
        {rows.map((r) => {
          const quiet = r.rps <= 0;
          const resourceName = r.resourceId ? nameByResourceId.get(r.resourceId) : undefined;
          return (
            <div
              key={r.host}
              className="flex items-center gap-3 border-b border-border/40 px-4 py-2 font-mono text-[11.5px]"
            >
              <span className="min-w-0 flex-[2] truncate text-foreground/85">{r.host}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {resourceName ?? "—"}
              </span>
              <span className={cn("w-16 text-right", quiet && "text-muted-foreground/60")}>
                {quiet ? "0" : formatRps(r.rps)}
              </span>
              <span className={cn("w-16 text-right", quiet && "text-muted-foreground/60")}>
                {quiet ? "—" : `${Math.round(r.p95)}ms`}
              </span>
              <span
                className={cn(
                  "w-16 text-right",
                  quiet && "text-muted-foreground/60",
                  !quiet && r.errorRate > ERROR_RATE_ALERT && "text-destructive",
                )}
              >
                {quiet ? "—" : `${(r.errorRate * 100).toFixed(1)}%`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** "1.2k", "312", "42.1", "0.03" — mirrors the graph chip's formatting. */
function formatRps(rps: number): string {
  if (rps >= 10_000) return `${(rps / 1000).toFixed(0)}k`;
  if (rps >= 1000) return `${(rps / 1000).toFixed(1)}k`;
  if (rps >= 100) return rps.toFixed(0);
  if (rps >= 10) return rps.toFixed(1);
  return rps.toFixed(2);
}

function TrafficPending() {
  return (
    <div className="h-full overflow-hidden">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-border/40 px-4 py-2.5">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="ml-auto h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

function CenterMessage({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-muted-foreground">
      {text}
    </div>
  );
}
