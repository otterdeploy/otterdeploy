import { createFileRoute } from "@tanstack/react-router";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";

export const Route = createFileRoute("/_dashboard/project/$projectId/deployments")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="grid h-full place-items-center p-8">
      <Empty>
        <EmptyTitle>Deployments</EmptyTitle>
        <EmptyDescription>History across services and environments. Lands in Plan 4.</EmptyDescription>
      </Empty>
    </div>
  );
}
