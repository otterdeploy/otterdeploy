import { orpc } from "@/utils/orpc";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/project/")({
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
      <ul>
        {projects.items.map((project) => (
          <li key={project.id}>{project.name}</li>
        ))}
      </ul>
    </div>
  );
}
