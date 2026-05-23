import { Placeholder } from "@/features/shell/components/placeholder";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$workspaceId/databases")({
  staticData: { crumb: "Databases" },
  component: () => <Placeholder title="Databases" description="All managed databases in this workspace." />,
});
