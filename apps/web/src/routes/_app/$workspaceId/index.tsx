import { Button } from "@/shared/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$workspaceId/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { workspaceId } = Route.useParams();
  const { workspace } = useLoaderData({ from: "/_app/$workspaceId" });

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Open a project to manage its services, databases, and routes.
          </p>
        </div>
        <Button variant="outline" className="gap-2">
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-4" />
          New project
        </Button>
      </header>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {workspace.projects.map((project) => (
          <li key={project.id}>
            <Link
              to="/$workspaceId/projects/$projectId"
              params={{ workspaceId, projectId: project.id }}
              className="group flex h-full flex-col gap-4 rounded-xl border bg-card p-4 transition-colors hover:bg-accent/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{project.name}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {project.slug}
                  </div>
                </div>
                <span className="rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  project
                </span>
              </div>

              <ProjectVisualization project={project} />

              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>
                  <span className="font-medium text-foreground">
                    {project.databases}
                  </span>{" "}
                  {project.databases === 1 ? "database" : "databases"}
                </span>
                <span>
                  <span className="font-medium text-foreground">
                    {project.routes}
                  </span>{" "}
                  {project.routes === 1 ? "route" : "routes"}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProjectVisualization({
  project,
}: {
  project: { databases: number; routes: number };
}) {
  const isEmpty = project.databases === 0 && project.routes === 0;

  return (
    <div
      className="relative flex h-28 items-center justify-center rounded-lg border bg-muted/20"
      style={{
        backgroundImage:
          "radial-gradient(circle, color-mix(in oklab, var(--muted-foreground) 30%, transparent) 1px, transparent 1px)",
        backgroundSize: "12px 12px",
      }}
    >
      {isEmpty ? (
        <span className="font-mono text-xs text-muted-foreground/60">empty</span>
      ) : (
        <>
          {Array.from({ length: project.databases }).map((_, i) => (
            <div
              key={`db-${i}`}
              className="mx-0.5 h-10 w-5 rounded-sm bg-muted-foreground/30"
            />
          ))}
          <span className="ml-2 size-2 rounded-full bg-amber-500" />
        </>
      )}
    </div>
  );
}
