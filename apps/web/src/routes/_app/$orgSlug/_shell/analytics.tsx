/**
 * Top-level Analytics: the one traffic surface, promoted out of the project
 * shell because on a real install most edge traffic (the control-plane
 * dashboard above all) belongs to no project — a project-nested view could
 * only ever show a slice. Install admins see every host on the box; other
 * members see their org's domains. The range rides the URL.
 */
import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { ANALYTICS_RANGES } from "@/features/analytics/analytics-model";
import { AnalyticsView } from "@/features/analytics/components/analytics-view";
import { orpc, queryClient } from "@/shared/server/orpc";

const zAnalyticsSearch = z.object({
  range: z.enum(ANALYTICS_RANGES).catch("24h"),
});

export const Route = createFileRoute("/_app/$orgSlug/_shell/analytics")({
  staticData: { crumb: "Analytics" },
  validateSearch: zAnalyticsSearch,
  component: RouteComponent,
  // Warm the default-range overview on hover (intent-preload). Scope must
  // match what the component will ask for, or the prefetch is a wasted entry.
  loader: ({ context }) => {
    const input = context.isInstallAdmin
      ? ({ installWide: true, range: "24h" } as const)
      : ({ range: "24h" } as const);
    void queryClient
      .prefetchQuery(orpc.edgeLogs.analytics.overview.queryOptions({ input }))
      .catch(() => undefined);
  },
});

function RouteComponent() {
  const { isInstallAdmin } = Route.useRouteContext();
  const { range } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-sm font-semibold">Analytics</h1>
        <p className="text-xs text-muted-foreground">
          {isInstallAdmin
            ? "Requests, visitors, and response health for every domain on this install, dashboard included."
            : "Requests, visitors, and response health across your organization's public domains."}
        </p>
      </div>
      <AnalyticsView
        installWide={isInstallAdmin}
        range={range}
        onRangeChange={(next) => void navigate({ search: { range: next }, replace: true })}
      />
    </div>
  );
}
