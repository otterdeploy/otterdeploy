import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/projects/$projectId/logs")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <h2 className="text-lg font-semibold">Logs</h2>
        <p className="text-sm text-muted-foreground mt-1">
          View and search through your application logs.
        </p>
      </div>
    </div>
  );
}
