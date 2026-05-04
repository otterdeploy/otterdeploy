import { createFileRoute } from "@tanstack/react-router";
import { RequestsOverview } from "@/features/workspace-ops";

export const Route = createFileRoute("/_dashboard/requests")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="p-6">
      <RequestsOverview />
    </div>
  );
}
