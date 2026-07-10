import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Activity03Icon } from "@hugeicons/core-free-icons";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import { ProjectMetricsSection } from "@/features/resources/components/_shared/metrics/project-metrics-section";
import { ResourceMetricsCard } from "@/features/resources/components/_shared/metrics/resource-metrics-card";
import {
  PROJECT_METRIC_WINDOWS,
  RESOURCE_DETAIL_MAX_MINUTES,
  type ProjectMetricWindowLabel,
} from "@/features/resources/components/_shared/metrics/use-project-metrics";
import type { ProjectResource } from "@/features/projects/components/graph/resource-to-node";
import { resourceCollection } from "@/features/resources/data/resource";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/shared/components/ui/toggle-group";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/metrics")({
  staticData: { crumb: "Metrics" },
  component: RouteComponent,
});

function RouteComponent() {
  const { orgSlug, projectSlug } = Route.useParams();
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });

  // Same source the graph reads from — services and databases both have
  // sampled containers, so the overview charts every resource.
  const { data: resources } = useLiveQuery(
    (q) =>
      q
        .from({ r: resourceCollection })
        .where(({ r }) => eq(r.projectId, project.id)),
    [project.id],
  );

  const [window, setWindow] = useState<ProjectMetricWindowLabel>("30m");
  const minutes =
    PROJECT_METRIC_WINDOWS.find((w) => w.label === window)?.minutes ?? 30;
  // The per-resource detail query caps at 24h; project aggregates and the
  // edge-log request series carry the full 7d retention.
  const resourceMinutes = Math.min(minutes, RESOURCE_DETAIL_MAX_MINUTES);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-sm font-semibold">Metrics</h1>
          <p className="text-xs text-muted-foreground">
            Project totals plus CPU, memory, and network for every resource.
            History is kept for 7 days.
          </p>
        </div>
        <ToggleGroup
          value={[window]}
          onValueChange={(next) => {
            const v = next[0];
            if (v) setWindow(v as ProjectMetricWindowLabel);
          }}
          variant="outline"
          size="sm"
          spacing={0}
        >
          {PROJECT_METRIC_WINDOWS.map((w) => (
            <ToggleGroupItem
              key={w.label}
              value={w.label}
              aria-label={`Last ${w.label}`}
              className="px-2.5 font-mono text-xs"
            >
              {w.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <ProjectMetricsSection projectId={project.id} windowMinutes={minutes} />

      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-medium">Resources</h2>
        {minutes > RESOURCE_DETAIL_MAX_MINUTES ? (
          <span className="text-xs text-muted-foreground">
            per-resource cards show the last 24h
          </span>
        ) : null}
      </div>

      {resources.length === 0 ? (
        <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
          <EmptyHeader>
            <HugeiconsIcon
              icon={Activity03Icon}
              strokeWidth={1.5}
              className="size-10 text-muted-foreground/50"
            />
            <EmptyTitle>No resources to chart</EmptyTitle>
            <EmptyDescription>
              Add a service or database to this project and its CPU, memory,
              and network usage will appear here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {(resources as ProjectResource[]).map((r) => (
            <ResourceMetricsCard
              key={r.resourceId}
              resource={r}
              orgSlug={orgSlug}
              projectSlug={projectSlug}
              windowMinutes={resourceMinutes}
            />
          ))}
        </div>
      )}
    </div>
  );
}
