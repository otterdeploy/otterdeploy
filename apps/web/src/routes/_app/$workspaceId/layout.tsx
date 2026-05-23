import { AppSidebar } from "@/features/shell/components/app-sidebar";
import { SiteHeader } from "@/features/shell/components/site-header";
import { SidebarInset, SidebarProvider } from "@/shared/components/ui/sidebar";
import { ID_PREFIX, zId } from "@otterstack/shared/id";
import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";
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
  return (
    <div className="[--header-height:calc(--spacing(12))]">
      <SidebarProvider defaultOpen={false} className="flex flex-col">
        <SiteHeader />
        <div className="flex flex-1">
          <AppSidebar collapsible="icon" />
          <SidebarInset>
            <Outlet />
          </SidebarInset>
        </div>
      </SidebarProvider>
    </div>
  );
}
