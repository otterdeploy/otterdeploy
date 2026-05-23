import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$orgSlug/$projectId/")({
  staticData: { crumb: "Overview" },
  component: RouteComponent,
});

function RouteComponent() {
  const { organization } = useLoaderData({
    from: "/_app/$orgSlug",
  });
  const { project } = useLoaderData({
    from: "/_app/$orgSlug/$projectId",
  });

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">{project.name}</h1>
      <p className="text-muted-foreground">Project overview / control plane.</p>

      <Link
        params={{ orgSlug: organization.slug, projectId: project.id }}
        to="/$orgSlug/$projectId/graph"
      >
        <button>Go to {project.name}</button>
      </Link>
    </div>
  );
}
