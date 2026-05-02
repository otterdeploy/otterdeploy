import { createFileRoute } from "@tanstack/react-router";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";

export const Route = createFileRoute("/_dashboard/members")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="grid h-full place-items-center p-8">
      <Empty>
        <EmptyTitle>Members</EmptyTitle>
        <EmptyDescription>RBAC, invitations, personal access tokens. Lands in Plan 3.</EmptyDescription>
      </Empty>
    </div>
  );
}
