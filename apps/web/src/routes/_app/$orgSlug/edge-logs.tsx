import { createFileRoute } from "@tanstack/react-router";

import { EdgeLogsView } from "@/features/edge-logs/components/edge-logs-view";

export const Route = createFileRoute("/_app/$orgSlug/edge-logs")({
  staticData: { crumb: "Edge logs" },
  component: RouteComponent,
});

function RouteComponent() {
  // Org-wide edge traffic (no projectId → all of the org's domains).
  return <EdgeLogsView />;
}
