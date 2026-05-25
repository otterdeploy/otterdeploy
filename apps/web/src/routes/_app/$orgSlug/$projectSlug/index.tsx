import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/")({
  staticData: { crumb: "Overview" },
  component: RouteComponent,
});

function RouteComponent() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });

  const orgSlug = organization.slug;
  const projectSlug = project.slug;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">{project.name}</h1>
      <p className="text-muted-foreground">Project overview / control plane.</p>

      <Link params={{ orgSlug, projectSlug }} to="/$orgSlug/$projectSlug/graph">
        <button>Go to {project.name}</button>
      </Link>
    </div>
  );
}
