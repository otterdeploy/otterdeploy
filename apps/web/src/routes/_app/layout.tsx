import type { Id } from "@otterstack/shared/id";
import { createFileRoute, Outlet } from "@tanstack/react-router";

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

export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    const user = {
      id: 1,
      name: "json time",
      initials: "JT",
      email: "email@example.com",
      image: "",
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
