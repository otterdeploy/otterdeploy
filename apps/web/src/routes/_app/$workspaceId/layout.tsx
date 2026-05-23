import { WorkspaceSidebar } from "@/features/shell/components/sidebar";

import { SiteHeader } from "@/features/shell/components/site-header";

import { SidebarInset, SidebarProvider } from "@/shared/components/ui/sidebar";
import { ID_PREFIX, zId } from "@otterstack/shared/id";
import {
  createFileRoute,
  notFound,
  Outlet,
  useMatch,
} from "@tanstack/react-router";
import * as z from "zod";

const zWorkspaceId = z.object({ workspaceId: zId(ID_PREFIX.workspace) });

export const Route = createFileRoute("/_app/$workspaceId")({
  component: RouteComponent,
  params: {
    parse: ({ workspaceId }) => zWorkspaceId.parse({ workspaceId }),
  },
  loader: ({ context, params }) => {
    const workspace = context.workspaces.find(
      (w) => w.id === params.workspaceId,
    );
    if (!workspace) throw notFound();
    return { crumb: workspace.name, workspace };
  },
});

function RouteComponent() {
  const { user } = Route.useRouteContext();
  const match = useMatch({
    from: "/_app/$workspaceId/$projectId",
    shouldThrow: false,
  });

  return (
    <div className="[--header-height:calc(--spacing(12))]">
      <SidebarProvider defaultOpen={false} className="flex flex-col">
        <SiteHeader />
        <div className="flex flex-1">
          {!match ? (
            <>
              <WorkspaceSidebar collapsible="icon" user={user} />
              <SidebarInset>
                <Outlet />
              </SidebarInset>
            </>
          ) : (
            <Outlet />
          )}
        </div>
      </SidebarProvider>
    </div>
  );
}
