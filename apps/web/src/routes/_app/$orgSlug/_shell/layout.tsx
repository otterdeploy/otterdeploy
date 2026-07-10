import { ProjectSidebar } from "@/features/shell/components/sidebar/project-sidebar";

import { SiteHeader } from "@/features/shell/components/site-header";
import { UpdateBanner, UpdateProvider } from "@/features/updates";

import { SidebarInset, SidebarProvider } from "@/shared/components/ui/sidebar";
import { createFileRoute, Outlet, useMatch } from "@tanstack/react-router";

/**
 * Operational shell — the pathless chrome wrapping every day-to-day org page
 * (and the whole project surface). Pathless: URLs are unchanged, the segment
 * only groups files. The settings zone (`../settings/`) deliberately lives
 * OUTSIDE this layout and renders its own chrome — the two never coexist.
 */
export const Route = createFileRoute("/_app/$orgSlug/_shell")({
  component: RouteComponent,
});

function RouteComponent() {
  const { user } = Route.useRouteContext();
  const match = useMatch({
    from: "/_app/$orgSlug/_shell/$projectSlug",
    shouldThrow: false,
  });

  return (
    <div className="[--header-height:calc(--spacing(12))]">
      {/* UpdateProvider owns the update dialog + the once-per-load background
          check, so the banner/header pill light up anywhere in the org shell. */}
      <UpdateProvider>
        <SidebarProvider defaultOpen={false} className="flex flex-col">
          {/* Banner lives above the header so it reads as a system-level
              notice about the app, not a bar wedged into the app body. */}
          <UpdateBanner />
          <SiteHeader />
          <div className="flex flex-1">
            {!match ? (
              <>
                {/* No project here — sidebar collapses to just the org
                    switcher + footer. Project sections appear once the
                    user navigates into a project. */}
                <ProjectSidebar collapsible="icon" user={user} />
                <SidebarInset>
                  <Outlet />
                </SidebarInset>
              </>
            ) : (
              <Outlet />
            )}
          </div>
        </SidebarProvider>
      </UpdateProvider>
    </div>
  );
}
