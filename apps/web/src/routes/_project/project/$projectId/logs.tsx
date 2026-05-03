import { createFileRoute } from "@tanstack/react-router";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";

export const Route = createFileRoute("/_dashboard/project/$projectId/logs")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="grid h-full place-items-center p-8">
      <Empty>
        <EmptyTitle>Logs</EmptyTitle>
        <EmptyDescription>Live tail across services, filter by service & severity. Lands in Plan 4.</EmptyDescription>
      </Empty>
    </div>
  );
}
