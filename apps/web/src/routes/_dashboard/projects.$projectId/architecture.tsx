import { createFileRoute } from "@tanstack/react-router";

import { ArchitecturePage } from "@/components/architecture/architecture-page";

export const Route = createFileRoute(
  "/_dashboard/projects/$projectId/architecture",
)({
  component: ArchitectureRoute,
});

function ArchitectureRoute() {
  const { projectId } = Route.useParams();
  return <ArchitecturePage projectId={projectId} />;
}
