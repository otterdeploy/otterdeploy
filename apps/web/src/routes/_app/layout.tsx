import { idSchema, type OrganizationId } from "@otterdeploy/shared/id";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { CommandPalette } from "@/features/command-palette";
import { useInstallCallbackToast } from "@/features/git-providers/install-callback-toast";
import { ResourceOverlayProvider } from "@/features/projects/components/new-resource/overlay-provider";
import { authClient } from "@/lib/auth-client";

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
    // Fire both independent reads concurrently — the session gate and the org
    // list don't depend on each other, so there's no reason to await them in
    // series. getSession is a local cookie read now (better-auth cookieCache),
    // so this collapses the app-entry gate to a single org.list round-trip.
    const [session, orgs] = await Promise.all([
      authClient.getSession(),
      authClient.organization.list(),
    ]);
    if (!session.data) {
      throw redirect({
        to: "/sign-in",
        search: { redirect: location.pathname },
      });
    }
    if (orgs.error) {
      throw new Error(orgs.error.message ?? "Failed to load organizations");
    }
    // Brand every org id at this single entry point (better-auth types them as
    // plain `string`). Downstream `organization.id` is `OrganizationId` for
    // free — no per-callsite laundering. Safe at runtime: auth's `generateId`
    // override always prefixes org ids with `org_` (packages/auth/src/index.ts).
    const organizations = (orgs.data ?? []).map((o) => ({
      ...o,
      id: idSchema.organization.parse(o.id),
    }));
    if (organizations.length === 0) {
      throw redirect({ to: "/onboarding/create-organization" });
    }

    const activeId = session.data.session.activeOrganizationId;
    const activeOrg = organizations.find((o) => o.id === activeId) ?? organizations[0];

    const u = session.data.user;
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
  return (
    <ResourceOverlayProvider>
      <Outlet />
      <CommandPalette />
    </ResourceOverlayProvider>
  );
}
