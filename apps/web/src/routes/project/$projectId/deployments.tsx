import { createFileRoute } from "@tanstack/react-router";
import { DeploymentsTable } from "@/features/project-deployments";

export const Route = createFileRoute("/project/$projectId/deployments")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="grid gap-4 p-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Deployments</h1>
        <p className="text-sm text-muted-foreground">
          Build + deploy history across this project's services and environments.
        </p>
      </div>
      <DeploymentsTable scope="project" />
    </div>
  );
}
