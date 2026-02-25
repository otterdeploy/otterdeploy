import { createFileRoute } from "@tanstack/react-router";
import { Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/dash/projects/$projectId")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="flex flex-col gap-4 h-full">
      Hello "/dash/projects/$projectId/layouts"!
      <div className="flex-1 p-3 border rounded-2xl h-full">
        <Outlet />
      </div>
    </div>
  );
}
