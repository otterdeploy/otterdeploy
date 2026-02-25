import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/projects/$projectId/observability")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <h2 className="text-lg font-semibold">Observability</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Monitor your services and track performance metrics.
        </p>
      </div>
    </div>
  );
}
