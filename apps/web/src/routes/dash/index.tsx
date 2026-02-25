import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dash/")({
  component: RouteComponent,
  beforeLoad: async () => {
    throw redirect({ to: "/dash/projects" });
  },
});

function RouteComponent() {
  return <Outlet />;
}
