import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import { EdgeLogsView } from "@/features/edge-logs/components/edge-logs-view";

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/edge-logs")({
  staticData: { crumb: "Edge logs" },
  component: RouteComponent,
});

function RouteComponent() {
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });
  return <EdgeLogsView projectId={project.id} />;
}
