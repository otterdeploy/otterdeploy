import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$workspaceId/$projectId/")({
  staticData: { crumb: "Overview" },
  component: RouteComponent,
});

function RouteComponent() {
  const { workspace } = useLoaderData({
    from: "/_app/$workspaceId",
  });
  const { project } = useLoaderData({
    from: "/_app/$workspaceId/$projectId",
  });

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">{project.name}</h1>
      <p className="text-muted-foreground">Project overview / control plane.</p>

      <Link
        params={{ workspaceId: workspace.id, projectId: project.id }}
        to="/$workspaceId/$projectId/graph"
      >
        <button>Go to {project.name}</button>
      </Link>
    </div>
  );
}
