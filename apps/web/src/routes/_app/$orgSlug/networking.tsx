import { Placeholder } from "@/features/shell/components/placeholder";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$orgSlug/networking")({
  staticData: { crumb: "Networking" },
  component: () => (
    <Placeholder
      title="Networking"
      description="Networking configuration for the workspace."
    />
  ),
});
