import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/layout")({
  component: RouteComponent,
});

function RouteComponent() {
  return <Outlet />;
}
