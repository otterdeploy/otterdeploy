import { Placeholder } from "@/features/shell/components/placeholder";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$workspaceId/$projectId/graph")({
  component: RouteComponent,
  staticData: { crumb: "Graph" },
});

function RouteComponent() {
  return (
    <Placeholder title="Graph" description="Visualize your project's graph." />
  );
}
