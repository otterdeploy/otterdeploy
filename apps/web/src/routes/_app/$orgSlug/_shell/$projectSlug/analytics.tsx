/**
 * Project Analytics tab: traffic across the project's public domains, served
 * from the edge-stat rollups (any window, exact counts, outlives the raw
 * log's retention). The range rides the URL so a pasted link opens on the
 * same window.
 */
import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import * as z from "zod";

import { AnalyticsView } from "@/features/analytics/components/analytics-view";
import { ANALYTICS_RANGES } from "@/features/analytics/analytics-model";
import { projectIdBySlug } from "@/features/projects/data/project";
import { orpc, queryClient } from "@/shared/server/orpc";

const zAnalyticsSearch = z.object({
  range: z.enum(ANALYTICS_RANGES).catch("24h"),
});

export const Route = createFileRoute("/_app/$orgSlug/_shell/$projectSlug/analytics")({
  staticData: { crumb: "Analytics" },
  validateSearch: zAnalyticsSearch,
  component: RouteComponent,
  // Warm the default-range overview on hover (intent-preload) so the tab
  // renders from cache instead of spinning. Non-blocking + best-effort.
  loader: ({ params }) => {
    const projectId = projectIdBySlug(params.projectSlug);
    if (!projectId) return;
    void queryClient
      .prefetchQuery(
        orpc.edgeLogs.analytics.overview.queryOptions({
          input: { projectId, range: "24h" },
        }),
      )
      .catch(() => undefined);
  },
});

function RouteComponent() {
  const { project } = useLoaderData({ from: "/_app/$orgSlug/_shell/$projectSlug" });
  const { range } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-sm font-semibold">Analytics</h1>
        <p className="text-xs text-muted-foreground">
          Requests, visitors, and response health across this project&apos;s public domains.
        </p>
      </div>
      <AnalyticsView
        projectId={project.id}
        range={range}
        onRangeChange={(next) => void navigate({ search: { range: next }, replace: true })}
      />
    </div>
  );
}
