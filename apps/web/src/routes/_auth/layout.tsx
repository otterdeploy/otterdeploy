import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="grid min-h-svh place-items-center bg-background p-6">
      <div className="w-full max-w-sm">
        <Outlet />
      </div>
    </div>
  );
}
