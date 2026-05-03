import { createFileRoute } from "@tanstack/react-router";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";

export const Route = createFileRoute("/_dashboard/project/$projectId/variables")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="grid h-full place-items-center p-8">
      <Empty>
        <EmptyTitle>Variables</EmptyTitle>
        <EmptyDescription>Shared env vars per environment. Lands in Plan 4.</EmptyDescription>
      </Empty>
    </div>
  );
}
