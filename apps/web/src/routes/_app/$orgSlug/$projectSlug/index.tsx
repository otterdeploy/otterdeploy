import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";

import { ID_PREFIX, type Slug } from "@otterstack/shared/id";

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/")({
  staticData: { crumb: "Overview" },
  component: RouteComponent,
});

function RouteComponent() {
  const { organization } = useLoaderData({
    from: "/_app/$orgSlug",
  });
  const { project } = useLoaderData({
    from: "/_app/$orgSlug/$projectSlug",
  });

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">{project.name}</h1>
      <p className="text-muted-foreground">Project overview / control plane.</p>

      <Link
        params={{
          orgSlug: organization.slug,
          projectSlug: project.slug as Slug<typeof ID_PREFIX.project>,
        }}
        to="/$orgSlug/$projectSlug/graph"
      >
        <button>Go to {project.name}</button>
      </Link>
    </div>
  );
}
