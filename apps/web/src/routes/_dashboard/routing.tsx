import { createFileRoute } from "@tanstack/react-router";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";

export const Route = createFileRoute("/_dashboard/routing")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="grid h-full place-items-center p-8">
      <Empty>
        <EmptyTitle>Routing</EmptyTitle>
        <EmptyDescription>Global Caddyfile root: domains, certs, redirects. Lands in Plan 3.</EmptyDescription>
      </Empty>
    </div>
  );
}
