import type { Id } from "@otterstack/shared/id";
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    const user = { id: 1, name: "json time" };
    const workspaces = [
      {
        id: "wksp_ea22c2xs" as Id<"wksp">,
        name: "dream team",
        active: true,
      },
      {
        id: "wksp_sdc72gq" as Id<"wksp">,
        name: "sec team",
        active: false,
      },
    ];
    return { user, workspaces };
  },
  component: RouteComponent,
});

function RouteComponent() {
  return <Outlet />;
}
