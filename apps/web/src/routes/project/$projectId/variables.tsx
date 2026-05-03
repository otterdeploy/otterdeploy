import { createFileRoute } from "@tanstack/react-router";
import { VariablesTable } from "@/features/project-variables";

export const Route = createFileRoute("/project/$projectId/variables")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="grid gap-4 p-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Variables</h1>
        <p className="text-sm text-muted-foreground">
          Shared env vars per environment, referenced from services as{" "}
          <code className="text-xs">{"${shared.X}"}</code>.
        </p>
      </div>
      <VariablesTable scope="project" />
    </div>
  );
}
