import { createFileRoute } from "@tanstack/react-router";

import { MembersTable } from "@/features/workspace-members";

export const Route = createFileRoute("/_dashboard/members")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="p-6">
      <MembersTable />
    </div>
  );
}
