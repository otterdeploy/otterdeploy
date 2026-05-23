import { ID_PREFIX, zId } from "@otterstack/shared/id";
import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";
import * as z from "zod";

const zProjectId = z.object({ projectId: zId(ID_PREFIX.project) });

export const Route = createFileRoute("/_app/$workspaceId/projects/$projectId")({
  params: {
    parse: ({ projectId }) => zProjectId.parse({ projectId }),
  },
  loader: ({ context, params }) => {
    const workspace = context.workspaces.find(
      (w) => w.id === params.workspaceId,
    );
    const project = workspace?.projects.find((p) => p.id === params.projectId);
    if (!project) throw notFound();
    return { crumb: project.name, project };
  },
  component: RouteComponent,
});

function RouteComponent() {
  return <Outlet />;
}
