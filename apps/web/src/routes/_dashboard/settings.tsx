import { createFileRoute } from "@tanstack/react-router";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";

export const Route = createFileRoute("/_dashboard/settings")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="grid h-full place-items-center p-8">
      <Empty>
        <EmptyTitle>Settings</EmptyTitle>
        <EmptyDescription>Workspace name, SSO, integrations, billing. Lands in Plan 3.</EmptyDescription>
      </Empty>
    </div>
  );
}
