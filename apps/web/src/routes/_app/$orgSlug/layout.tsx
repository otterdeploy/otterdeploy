import { OrganizationSidebar } from "@/features/shell/components/sidebar";

import { SiteHeader } from "@/features/shell/components/site-header";

import { SidebarInset, SidebarProvider } from "@/shared/components/ui/sidebar";
import {
  createFileRoute,
  notFound,
  Outlet,
  useMatch,
} from "@tanstack/react-router";
import * as z from "zod";

const zOrgSlug = z.object({
  orgSlug: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

export const Route = createFileRoute("/_app/$orgSlug")({
  component: RouteComponent,
  params: {
    parse: zOrgSlug.parse,
  },
  loader: ({ context, params }) => {
    const organization = context.organizations.find(
      (o) => o.slug === params.orgSlug,
    );
    if (!organization) throw notFound();
    return { crumb: organization.name, organization };
  },
});

function RouteComponent() {
  const { user } = Route.useRouteContext();
  const match = useMatch({
    from: "/_app/$orgSlug/$projectId",
    shouldThrow: false,
  });

  return (
    <div className="[--header-height:calc(--spacing(12))]">
      <SidebarProvider defaultOpen={false} className="flex flex-col">
        <SiteHeader />
        <div className="flex flex-1">
          {!match ? (
            <>
              <OrganizationSidebar collapsible="icon" user={user} />
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
