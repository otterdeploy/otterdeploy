import { createFileRoute } from "@tanstack/react-router";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";

export const Route = createFileRoute("/_dashboard/activity")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="grid h-full place-items-center p-8">
      <Empty>
        <EmptyTitle>Activity</EmptyTitle>
        <EmptyDescription>Workspace audit log. Lands in Plan 3.</EmptyDescription>
      </Empty>
    </div>
  );
}
