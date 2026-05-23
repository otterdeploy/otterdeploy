import { Placeholder } from "@/features/shell/components/placeholder";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$orgSlug/servers")({
  staticData: { crumb: "Servers" },
  component: () => (
    <Placeholder
      title="Servers"
      description="List of servers in the workspace."
    />
  ),
});
