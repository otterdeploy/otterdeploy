import { ID_PREFIX, zSlug } from "@otterdeploy/shared/id";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";
import * as z from "zod";

import { useProjectDeployStatus } from "@/features/deployments/hooks/use-deploy-status";
import { envCollection } from "@/features/projects/data/env";
import { projectCollection } from "@/features/projects/data/project";
import { resourceCollection } from "@/features/resources/data/resource";
import { inActiveEnvironment } from "@/features/shell/environment-scope";
import { useActiveEnvironment } from "@/features/shell/use-active-environment";
import { useProjectEvents } from "@/features/projects/hooks/use-project-events";
import { useProjectStatus } from "@/features/projects/hooks/use-project-status";
import { PendingChangesBar } from "@/features/projects/components/pending-changes-bar";
import { ProjectTabs } from "@/features/projects/components/project-tabs";
import { ProjectSidebar } from "@/features/shell/components/sidebar/project-sidebar";
import { SidebarInset } from "@/shared/components/ui/sidebar";
import { Skeleton } from "@/shared/components/ui/skeleton";

const zProjectSlugParam = z.object({
  projectSlug: zSlug(ID_PREFIX.project),
});

// Shown while the project + env collections preload on navigation into a
// project. A tailored tab-row + content skeleton keeps the shell recognizable
// instead of the generic centered spinner on this high-traffic transition.
function ProjectShellPending() {
  return (
    <div className="flex h-full flex-1 flex-col gap-4 p-4">
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-md" />
        ))}
      </div>
      <Skeleton className="h-full w-full flex-1 rounded-xl" />
    </div>
  );
}

export const Route = createFileRoute("/_app/$orgSlug/_shell/projects/$projectSlug")({
  component: RouteComponent,
  pendingComponent: ProjectShellPending,
  params: { parse: (params) => zProjectSlugParam.parse(params) },
  loader: async ({ params }) => {
    await Promise.all([projectCollection.preload(), envCollection.preload()]);
    const project = projectCollection.toArray.find(
      (p) => p.slug === params.projectSlug,
    );

    if (!project) throw notFound();
    return { crumb: project.name, project };
  },
});

function RouteComponent() {
  const { user } = Route.useRouteContext();
  const { projectSlug } = Route.useParams();

  const { data: project } = useLiveQuery(
    (q) =>
      q
        .from({ p: projectCollection })
        .where(({ p }) => eq(p.slug, projectSlug))
        .findOne(),
    [projectSlug],
  );

  // Resolve the URL's environment (`/projects/$p/$env/…`, or the project's
  // default when the address has none) to an ID once, here. Every resource read in
  // this subtree scopes on it, and they must all agree or the shared resource
  // collection ends up holding two environments' rows at once.
  const activeEnv = useActiveEnvironment(project?.id);

  // Open a single project-wide event stream while this layout is mounted.
  // The hook invalidates the matching React Query caches on every server
  // push, so the existing useLiveQuery / useQuery hooks across child
  // routes refetch immediately instead of waiting on their polling
  // intervals.
  useProjectEvents(project?.id ?? null);

  // Publish this project's live task rollup to the tab. Mounted alongside the
  // event stream so the two share a lifetime: the tab stops reporting the
  // moment you leave the project.
  useProjectStatus(project?.id ?? null);

  // …and the build pipeline's state, which the task rollup cannot see: a
  // deployment has no swarm task while it is still building, so without this the
  // tab stays blank through the slowest part of a deploy.
  useProjectDeployStatus(project?.id ?? null);

  const { data: resources } = useLiveQuery(
    (q) =>
      q
        .from({ r: resourceCollection })
        .where(({ r }) =>
          and(eq(r.projectId, project?.id ?? ""), inActiveEnvironment(r.environmentId, activeEnv)),
        ),
    [project?.id, activeEnv.id, activeEnv.isMain],
  );

  const { data: environments } = useLiveQuery(
    (q) =>
      q
        .from({ e: envCollection })
        .where(({ e }) => eq(e.projectId, project?.id ?? "")),
    [project?.id],
  );

  if (!project) return null;

  const databases = resources.filter((r) => r.type === "database");
  // routes will come from a routeCollection in a follow-up; zero for now.
  const routes: never[] = [];

  const defaultEnv =
    environments.find((e) => e.slug === "production") ?? environments[0];
  const envSlug = activeEnv.slug ?? defaultEnv?.slug;

  return (
    <>
      <ProjectSidebar
        collapsible="icon"
        user={user}
        project={{
          ...project,
          databases: databases.length,
          routes: routes.length,
          environments,
        }}
      />
      <SidebarInset>
        <ProjectTabs />
        <Outlet />
      </SidebarInset>
      <PendingChangesBar projectId={project.id} environment={envSlug} />
    </>
  );
}
