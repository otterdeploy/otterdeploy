import { Placeholder } from "@/features/shell/components/placeholder";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$workspaceId/logs")({
  staticData: { crumb: "Logs" },
  component: () => <Placeholder title="Logs" description="Aggregated logs across the workspace." />,
});
