import { Placeholder } from "@/features/shell/components/placeholder";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$workspaceId/graph")({
  staticData: { crumb: "Graph" },
  component: () => <Placeholder title="Graph" description="Service and resource graph across the workspace." />,
});
