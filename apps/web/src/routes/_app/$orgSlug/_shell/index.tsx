import { createFileRoute } from "@tanstack/react-router";

import { ProjectsHome } from "@/features/projects/components/projects-home";
import { ProjectsSkeleton } from "@/features/projects/components/projects-skeleton";
import { projectCollection } from "@/features/projects/data/project";

// The org home: the project list. `/projects` renders the same component.
export const Route = createFileRoute("/_app/$orgSlug/_shell/")({
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
