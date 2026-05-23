import { Placeholder } from "@/features/shell/components/placeholder";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$workspaceId/dashboard")({
  staticData: { crumb: "Dashboard" },
  component: () => <Placeholder title="Dashboard" description="Workspace metrics and health." />,
});
