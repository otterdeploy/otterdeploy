import { Placeholder } from "@/features/shell/components/placeholder";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$orgSlug/team")({
  staticData: { crumb: "Team" },
  component: () => <Placeholder title="Team" description="Workspace members, roles, and invites." />,
});
