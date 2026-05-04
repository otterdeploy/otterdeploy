import { createFileRoute } from "@tanstack/react-router";
import { DockerResourcesOverview } from "@/features/workspace-ops";

export const Route = createFileRoute("/_dashboard/docker")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="p-6">
      <DockerResourcesOverview />
    </div>
  );
}
