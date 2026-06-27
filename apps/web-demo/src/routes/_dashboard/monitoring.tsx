import { createFileRoute } from "@tanstack/react-router";

import { MonitoringOverview } from "@/features/workspace-ops";

export const Route = createFileRoute("/_dashboard/monitoring")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="p-6">
      <MonitoringOverview />
    </div>
  );
}
