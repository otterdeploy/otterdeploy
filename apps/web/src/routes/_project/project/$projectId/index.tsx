import { createFileRoute } from "@tanstack/react-router";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";

export const Route = createFileRoute("/_dashboard/project/$projectId/")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="grid h-full place-items-center p-8">
      <Empty>
        <EmptyTitle>Canvas</EmptyTitle>
        <EmptyDescription>
          Project canvas lands in Plan 2. Services, databases, volumes, and routing show up here.
        </EmptyDescription>
      </Empty>
    </div>
  );
}
