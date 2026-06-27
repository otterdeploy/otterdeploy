import { createFileRoute } from "@tanstack/react-router";

import { SwarmOverview } from "@/features/workspace-ops";

export const Route = createFileRoute("/_dashboard/swarm")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="p-6">
      <SwarmOverview />
    </div>
  );
}
