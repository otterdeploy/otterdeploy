import { Placeholder } from "@/features/shell/components/placeholder";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$workspaceId/network")({
  staticData: { crumb: "Network" },
  component: () => <Placeholder title="Network" description="Routes, domains, and proxy configuration." />,
});
