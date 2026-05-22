import { AppSidebar } from "@/features/shell/components/app-sidebar";
import { SiteHeader } from "@/features/shell/components/site-header";
import { SidebarInset, SidebarProvider } from "@/shared/components/ui/sidebar";
import { zId, ID_PREFIX } from "@otterstack/shared/id";
import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

const zWorkspaceId = z.object({ workspaceId: zId(ID_PREFIX.workspace) });

export const Route = createFileRoute("/_app/$workspaceId/")({
  component: RouteComponent,
  params: {
    parse: ({ workspaceId }) => zWorkspaceId.parse({ workspaceId }),
  },
});

function RouteComponent() {
  const { workspaceId } = Route.useParams();

  return (
    <div className="[--header-height:calc(--spacing(14))]">
      <SidebarProvider className="flex flex-col">
        <SiteHeader />
        <div className="flex flex-1">
          <AppSidebar />
          <SidebarInset>
            <div className="flex flex-1 flex-col gap-4 p-4">
              <div className="grid auto-rows-min gap-4 md:grid-cols-3">
                <div className="aspect-video rounded-xl bg-muted/50" />
                <div className="aspect-video rounded-xl bg-muted/50" />
                <div className="aspect-video rounded-xl bg-muted/50" />
              </div>
              <div className="min-h-screen flex-1 rounded-xl bg-muted/50 md:min-h-min" />
            </div>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </div>
  );
}
