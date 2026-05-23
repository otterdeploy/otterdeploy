import { ID_PREFIX, zId } from "@otterstack/shared/id";
import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";
import * as z from "zod";

import { ProjectSidebar } from "@/features/shell/components/sidebar/project-sidebar";
import { SidebarInset } from "@/shared/components/ui/sidebar";

const zProjectId = z.object({ projectId: zId(ID_PREFIX.project) });
const zEnvSearch = z.object({ env: z.string().optional() });

export const Route = createFileRoute("/_app/$orgSlug/$projectId")({
  component: RouteComponent,
  validateSearch: zEnvSearch,
  params: {
    parse: ({ projectId }) => zProjectId.parse({ projectId }),
  },
  loader: ({ context, params }) => {
    const organization = context.organizations.find(
      (o) => o.slug === params.orgSlug,
    );
    const project = organization?.projects.find(
      (p) => p.id === params.projectId,
    );
    if (!project) throw notFound();
    return { crumb: project.name, project };
  },
});

function RouteComponent() {
  const { user } = Route.useRouteContext();
  const { project } = Route.useLoaderData();
  const { env } = Route.useSearch();
  const navigate = Route.useNavigate();

  const defaultEnv =
    project.environments.find((e) => e.slug === "production") ??
    project.environments[0];
  const envSlug = env ?? defaultEnv?.slug;

  return (
    <>
      <ProjectSidebar
        collapsible="icon"
        user={user}
        project={project}
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
