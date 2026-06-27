import { createFileRoute, Outlet } from "@tanstack/react-router";

import { WorkspaceShell } from "@/components/shell/workspace-shell";

export const Route = createFileRoute("/_dashboard")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <WorkspaceShell>
      <Outlet />
    </WorkspaceShell>
  );
}
