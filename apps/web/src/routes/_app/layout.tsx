import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    const user = { id: 1, name: "json time" };
    const workspaces = [{ id: 1, name: "dream team", active: true }];
    return { user, workspaces };
  },
  component: RouteComponent,
});

function RouteComponent() {
  return <Outlet />;
}
