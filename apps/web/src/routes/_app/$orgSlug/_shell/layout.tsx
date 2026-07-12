import { ProjectSidebar } from "@/features/shell/components/sidebar/project-sidebar";

import { SiteHeader } from "@/features/shell/components/site-header";
import { UpdateBanner, useUpdateStatus } from "@/features/updates";

import { SidebarInset, SidebarProvider } from "@/shared/components/ui/sidebar";
import { createFileRoute, Outlet, useMatch } from "@tanstack/react-router";
import { type CSSProperties, useState } from "react";

/**
 * Operational shell — the pathless chrome wrapping every day-to-day org page
 * (and the whole project surface). Pathless: URLs are unchanged, the segment
 * only groups files. The settings zone (`../settings/`) deliberately lives
 * OUTSIDE this layout and renders its own chrome — the two never coexist.
 */
export const Route = createFileRoute("/_app/$orgSlug/_shell")({
  component: RouteComponent,
});

/**
 * SidebarProvider writes the `sidebar_state` cookie on toggle but only ever
 * seeds its initial state from `defaultOpen` (the shadcn SSR contract) — so in
 * this SPA the persisted state was ignored and the sidebar reset on every load.
 * Read the cookie here to restore it, defaulting to OPEN when unset.
 */
function readSidebarDefaultOpen(): boolean {
  if (typeof document === "undefined") return true;
  const match = document.cookie.match(/(?:^|;\s*)sidebar_state=(true|false)/);
  return match ? match[1] === "true" : true;
}

function RouteComponent() {
  const { user } = Route.useRouteContext();
  const match = useMatch({
    from: "/_app/$orgSlug/_shell/$projectSlug",
    shouldThrow: false,
  });
  // Read once on mount so a re-render never clobbers the live toggle state.
  const [defaultSidebarOpen] = useState(readSidebarDefaultOpen);

  // The update banner (when shown) sits above the header, so the top chrome is
  // taller. `--header-height` is the offset every shell height calc subtracts
  // (sidebar, project tabs, full-height pages) — fold the banner's height in
  // here so they all stay inside the viewport instead of overflowing by a bar.
  const status = useUpdateStatus();
  const bannerShown = status.bannerVisible && status.latest !== null;

  return (
    <div
      // header bar (12) + banner (11) when shown, else just the header bar.
      style={
        { "--header-height": `calc(var(--spacing) * ${bannerShown ? 23 : 12})` } as CSSProperties
      }
    >
      {/* UpdateProvider lives in the parent $orgSlug layout — both chromes
          consume it (banner here, UpdatesCard in the settings zone). */}
      <SidebarProvider defaultOpen={defaultSidebarOpen} className="flex flex-col">
        {/* Banner + header are ONE pinned top region. Pinning them together —
            rather than the header alone via its own sticky, with the banner
            left in normal flow — is what keeps the banner from scrolling away
            and keeps the pinned chrome's height equal to --header-height, the
            offset the sidebar starts its `top` at. Pin only the header and an
            11px gap opens between header and sidebar once the banner scrolls
            off (and the banner disappears entirely). */}
        <div className="sticky top-0 z-50">
          <UpdateBanner />
          <SiteHeader />
        </div>
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
    </div>
  );
}
