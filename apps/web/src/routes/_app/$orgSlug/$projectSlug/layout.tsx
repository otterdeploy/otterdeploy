import { ID_PREFIX, zSlug } from "@otterstack/shared/id";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";
import * as z from "zod";

import { envCollection } from "@/features/projects/data/env";
import { projectCollection } from "@/features/projects/data/project";
import { ProjectSidebar } from "@/features/shell/components/sidebar/project-sidebar";
import { SidebarInset } from "@/shared/components/ui/sidebar";

const zProjectSlugParam = z.object({
  projectSlug: zSlug(ID_PREFIX.project),
});
const zEnvSearch = z.object({ env: z.string().optional() });

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug")({
  component: RouteComponent,
  validateSearch: zEnvSearch,
  params: {
    parse: zProjectSlugParam.parse,
  },
  loader: async ({ params }) => {
    await Promise.all([projectCollection.preload(), envCollection.preload()]);
    const project = projectCollection.toArray.find(
      (p) => p.slug === params.projectSlug,
    );
    if (!project) throw notFound();
    return { crumb: project.name };
  },
});

function RouteComponent() {
  const { user } = Route.useRouteContext();
  const { projectSlug } = Route.useParams();
  const { env } = Route.useSearch();
  const navigate = Route.useNavigate();

  const { data: project } = useLiveQuery(
    (q) =>
      q
        .from({ p: projectCollection })
        .where(({ p }) => eq(p.slug, projectSlug))
        .findOne(),
    [projectSlug],
  );

  const { data: environments = [] } = useLiveQuery(
    (q) =>
      q
        .from({ e: envCollection })
        .where(({ e }) => eq(e.projectId, project?.id ?? "")),
    [project?.id],
  );

  if (!project) return null;

  const defaultEnv =
    environments.find((e) => e.slug === "production") ?? environments[0];
  const envSlug = env ?? defaultEnv?.slug;

  return (
    <>
      <ProjectSidebar
        collapsible="icon"
        user={user}
        project={{ ...project, databases: 0, routes: 0, environments }}
        envSlug={envSlug}
        onEnvSlugChange={(slug) =>
          navigate({ search: (prev) => ({ ...prev, env: slug }) })
        }
      />
      <SidebarInset>
        <Outlet />
      </SidebarInset>
    </>
  );
}
