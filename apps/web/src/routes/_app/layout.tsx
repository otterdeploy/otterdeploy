import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";

export type Organization = {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  createdAt: string | Date;
};

// Shape consumed by the project-level sidebar. Backend `project.get` provides
// id/name/slug; `environments` come from the env router; `databases`/`routes`
// are placeholders zeroed until project-resource counts are wired.
export type Project = {
  id: string;
  name: string;
  slug: string;
  databases: number;
  routes: number;
  environments: Environment[];
};
export type Environment = {
  id: string;
  name: string;
  slug: string;
};

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
    const session = await authClient.getSession();
    if (!session.data) {
      throw redirect({
        to: "/sign-in",
        search: { redirect: location.pathname },
      });
    }

    const orgs = await authClient.organization.list();
    if (orgs.error) {
      throw new Error(orgs.error.message ?? "Failed to load organizations");
    }
    const organizations = orgs.data ?? [];
    if (organizations.length === 0) {
      throw redirect({ to: "/onboarding/create-organization" });
    }

    const activeId = session.data.session.activeOrganizationId;
    const activeOrg =
      organizations.find((o) => o.id === activeId) ?? organizations[0];

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
  return <Outlet />;
}
