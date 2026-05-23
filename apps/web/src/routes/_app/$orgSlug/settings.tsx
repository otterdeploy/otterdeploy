import { Placeholder } from "@/features/shell/components/placeholder";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$orgSlug/settings")({
  staticData: { crumb: "Settings" },
  component: () => <Placeholder title="Settings" description="Workspace preferences and configuration." />,
});
