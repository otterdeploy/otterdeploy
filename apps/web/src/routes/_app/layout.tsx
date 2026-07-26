import { type OrganizationId } from "@otterdeploy/shared/id";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { CommandPalette } from "@/features/command-palette";
import { useInstallCallbackToast } from "@/features/git-providers/install-callback-toast";
import { ResourceOverlayProvider } from "@/features/projects/components/new-resource/overlay-provider";
import { organizationsQuery, sessionQuery } from "@/lib/auth-queries";
import { queryClient } from "@/shared/server/orpc";
import { useFaviconStatus } from "@/shared/hooks/use-favicon-status";

export interface Organization {
  id: OrganizationId;
  name: string;
  slug: string;
  logo?: string | null;
  createdAt: string | Date;
}

// Shape consumed by the project-level sidebar. Backend `project.get` provides
// id/name/slug; `environments` come from the env router; `databases`/`routes`
// are placeholders zeroed until project-resource counts are wired.
export interface Project {
  id: string;
  name: string;
  slug: string;
  databases: number;
  routes: number;
  environments: Environment[];
}
export interface Environment {
  id: string;
  name: string;
  slug: string;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ location }) => {
    // ensureQueryData, NOT a direct authClient call: this gate runs on every
    // navigation, and hitting `/api/auth/*` twice each time exhausted the auth
    // rate limit (100/60s, shared across callers when no trusted-proxy IP is
    // available) — after which a 429 read as "signed out" and bounced the
    // operator to /sign-in mid-session. Within the 5min staleTime this is now a
    // cache read and makes no request at all. See lib/auth-queries.ts.
    //
    // Both reads are independent, so they still resolve concurrently.
    const [session, organizations] = await Promise.all([
      queryClient.ensureQueryData(sessionQuery),
      queryClient.ensureQueryData(organizationsQuery),
    ]);
    // Only a RESOLVED-but-absent session means "not signed in". A failed
    // request throws out of ensureQueryData above and never reaches here, so a
    // rate-limited or briefly-unreachable server can no longer masquerade as a
    // logout.
    if (!session) {
      throw redirect({
        to: "/sign-in",
        search: { redirect: location.pathname },
      });
    }
    if (organizations.length === 0) {
      throw redirect({ to: "/onboarding/create-organization" });
    }

    const activeId = session.session.activeOrganizationId;
    const activeOrg = organizations.find((o) => o.id === activeId) ?? organizations[0];

    const u = session.user;
    const user = {
      id: u.id,
      name: u.name,
      initials: initialsOf(u.name),
      email: u.email,
      image: u.image ?? "",
    };

    return {
      user,
      organizations,
      activeOrgSlug: activeOrg.slug,
    };
  },
  component: RouteComponent,
});

function RouteComponent() {
  // GitHub install-callback lands with ?git_install=… on whatever page the
  // connect was started from — handle the toast at the layout so every
  // landing page gets it.
  useInstallCallbackToast();
  // One favicon controller for the whole signed-in app. Mounted here rather
  // than at the root so the sign-in and device-approval pages keep the plain
  // static icon — they have no system state to report.
  useFaviconStatus();
  return (
    <ResourceOverlayProvider>
      <Outlet />
      <CommandPalette />
    </ResourceOverlayProvider>
  );
}
