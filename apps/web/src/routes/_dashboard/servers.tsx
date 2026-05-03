import { createFileRoute } from "@tanstack/react-router";
import { ServersTable } from "@/features/workspace-servers";

export const Route = createFileRoute("/_dashboard/servers")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="p-6">
      <ServersTable />
    </div>
  );
}
