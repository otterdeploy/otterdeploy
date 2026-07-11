import { createFileRoute } from "@tanstack/react-router";

import { zEdgeLogsSearch } from "@/features/edge-logs/data/edge-search";
import { EdgeLogsPage } from "@/features/edge-logs/components/edge-logs-page";

export const Route = createFileRoute("/_app/$orgSlug/_shell/edge-logs")({
  staticData: { crumb: "Edge logs" },
  validateSearch: zEdgeLogsSearch,
  component: RouteComponent,
});

function RouteComponent() {
  // Org-wide edge traffic (no projectId → all of the org's domains). The active
  // tab lives in the URL so each plane (access / events / firewall) is
  // deep-linkable; `replace` keeps tab switches out of the back-stack.
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <EdgeLogsPage
      tab={tab}
      onTabChange={(next) => navigate({ search: { tab: next }, replace: true })}
    />
  );
}
