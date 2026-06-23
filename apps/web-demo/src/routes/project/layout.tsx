import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/project/layout")({
  component: RouteComponent,
});

function RouteComponent() {
  return <Outlet />;
}
