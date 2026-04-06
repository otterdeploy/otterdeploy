import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/project")({
  component: RouteComponent,
});

function RouteComponent() {
  return <Outlet />;
}
