import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$workspaceId/projects/$projectId/graph")({
  staticData: { crumb: "Graph" },
  component: RouteComponent,
});

function RouteComponent() {
  return <div className="p-4">project graph</div>;
}
