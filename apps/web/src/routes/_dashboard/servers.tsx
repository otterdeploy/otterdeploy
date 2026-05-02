import { createFileRoute } from "@tanstack/react-router";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";

export const Route = createFileRoute("/_dashboard/servers")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="grid h-full place-items-center p-8">
      <Empty>
        <EmptyTitle>Servers</EmptyTitle>
        <EmptyDescription>Swarm nodes, CPU/mem/disk meters, drain & remove. Lands in Plan 3.</EmptyDescription>
      </Empty>
    </div>
  );
}
