import { type OrganizationId } from "@otterdeploy/shared/id";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { CommandPalette } from "@/features/command-palette";
import { useInstallCallbackToast } from "@/features/git-providers/install-callback-toast";
import { ResourceOverlayProvider } from "@/features/projects/components/new-resource/overlay-provider";
import { decideAuthGate } from "@/lib/auth-gate";
import { organizationsQuery, sessionQuery } from "@/lib/auth-queries";
import { useFaviconStatus } from "@/shared/hooks/use-favicon-status";
import { queryClient } from "@/shared/server/orpc";

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
    // A failed REQUEST throws out of ensureQueryData above and never reaches
    // here, so only definite answers about identity get this far. See
    // lib/auth-gate.ts for why each branch is the way it is.
    const decision = decideAuthGate({ session, organizations });
    if (decision.kind === "sign-in") {
      throw redirect({
        to: "/sign-in",
        search: { redirect: location.pathname },
      });
    }
    if (decision.kind === "onboarding") {
      throw redirect({ to: "/onboarding/create-organization" });
    }

    // `decision.organizations` rather than the raw read: the gate already
    // proved it non-null and non-empty, so this doesn't re-narrow it.
    const orgs = decision.organizations;
    const activeId = session.session.activeOrganizationId;
    const activeOrg = orgs.find((o) => o.id === activeId) ?? orgs[0];

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
      organizations: orgs,
      activeOrgSlug: activeOrg.slug,
      // Server-owned installation authority, already returned with every
      // session (packages/auth/src/index.ts marks it `returned: true`). Read
      // here so navigation can OMIT the surfaces it gates rather than render
      // them and let each one 403 on its own: `system.*`, `docker.*`,
      // `volumes.*`, server enrollment and the platform-settings router are
      // install-admin in their entirety, and their pages fire queries on mount.
      // This is presentation only — every one of those procedures still checks
      // the same flag server-side in authz/capability.ts, which is the boundary.
      isInstallAdmin: u.isInstallAdmin === true,
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
