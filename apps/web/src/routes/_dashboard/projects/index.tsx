import { orpc } from "@/utils/orpc";
import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/projects/")({
  component: RouteComponent,
  loader: async ({ context }) => {
    if (!context.auth.session.activeOrganizationId) throw new Error("No active organization");
    const projects = await context.queryClient.ensureQueryData(
      orpc.project.list.queryOptions({
        input: {
          organizationId: context.auth.session.activeOrganizationId,
        },
      }),
    );
    return { projects };
  },
});

function RouteComponent() {
  const { projects } = Route.useLoaderData();
  return (
    <div>
      <h1>Projects</h1>
      <ul className="flex flex-col gap-2 mt-4">
        {projects.items.map((project) => (
          <Link key={project.id} to="/projects/$projectId" params={{ projectId: project.id }}>
            {project.name}
          </Link>
        ))}
      </ul>
    </div>
  );
}
