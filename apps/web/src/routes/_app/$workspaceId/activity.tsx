import { Placeholder } from "@/features/shell/components/placeholder";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$workspaceId/activity")({
  staticData: { crumb: "Activity" },
  component: () => <Placeholder title="Activity" description="Audit trail and recent workspace events." />,
});
