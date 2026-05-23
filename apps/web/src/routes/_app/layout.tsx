import type { Id } from "@otterstack/shared/id";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";

export type Project = {
  id: Id<"project">;
  name: string;
  slug: string;
  databases: number;
  routes: number;
  environments: Environment[];
};
export type Environment = {
  id: Id<"env">;
  name: string;
  slug: string;
  databases: number;
  routes: number;
};

type Workspace = {
  id: Id<"wksp">;
  name: string;
  active: boolean;
  projects: Project[];
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
        search: { redirect: location.href },
      });
    }
    const u = session.data.user;
    const user = {
      id: u.id,
      name: u.name,
      initials: initialsOf(u.name),
      email: u.email,
      image: u.image ?? "",
    };
    const workspaces: Workspace[] = [
      {
        id: "wksp_ea22c2xs" as Id<"wksp">,
        name: "otterstack",
        active: true,
        projects: [
          {
            id: "project_acmeapi1" as Id<"project">,
            name: "Acme API",
            slug: "acme-api",
            databases: 2,
            routes: 2,
            environments: [
              {
                id: "env_acmeapi1" as Id<"env">,
                name: "Production",
                slug: "production",
                databases: 2,
                routes: 2,
              },
              {
                id: "env_acmeapi2" as Id<"env">,
                name: "Staging",
                slug: "staging",
                databases: 2,
                routes: 2,
              },
            ],
          },
          {
            id: "project_otters02" as Id<"project">,
            name: "Otters Web",
            slug: "otters-web",
            databases: 1,
            routes: 1,
            environments: [],
          },
          {
            id: "project_market03" as Id<"project">,
            name: "Marketing Site",
            slug: "marketing-site",
            databases: 0,
            routes: 0,
            environments: [],
          },
        ],
      },
      {
        id: "wksp_sdc72gq" as Id<"wksp">,
        name: "sec team",
        active: false,
        projects: [],
      },
    ];
    return { user, workspaces };
  },
  component: RouteComponent,
});

function RouteComponent() {
  return <Outlet />;
}
