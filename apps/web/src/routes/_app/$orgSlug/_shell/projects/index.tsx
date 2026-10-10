import { createFileRoute } from "@tanstack/react-router";

import { ProjectsHome } from "@/features/projects/components/projects-home";
import { ProjectsSkeleton } from "@/features/projects/components/projects-skeleton";
import { projectCollection } from "@/features/projects/data/project";

// The project list at its own address, beside the projects it lists. Same
// component as the org home.
export const Route = createFileRoute("/_app/$orgSlug/_shell/projects/")({
  staticData: { crumb: "Projects" },
  loader: async () => {
    await projectCollection.preload();
  },
  component: RouteComponent,
  pendingComponent: ProjectsSkeleton,
});

function RouteComponent() {
  const { orgSlug } = Route.useParams();
  return <ProjectsHome orgSlug={orgSlug} />;
}
