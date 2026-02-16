import { useMatches } from "@tanstack/react-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@otterstack/ui/components/ui/breadcrumb";
import { Fragment } from "react";

type Crumb = {
  label: string;
  to?: string;
};

function buildCrumbs(matches: ReturnType<typeof useMatches>): Crumb[] {
  const crumbs: Crumb[] = [];

  for (const match of matches) {
    const { pathname } = match;

    if (pathname === "/dashboard") {
      crumbs.push({ label: "Dashboard", to: "/dashboard" });
    } else if (pathname.startsWith("/projects/") && pathname.split("/").length === 3) {
      const ctx = match.context as Record<string, unknown> | undefined;
      const project = ctx?.project as { name?: string } | undefined;
      crumbs.push({ label: project?.name ?? "Project", to: pathname });
    } else if (pathname.endsWith("/architecture")) {
      crumbs.push({ label: "Architecture" });
    } else if (pathname.endsWith("/deployments") && !pathname.includes("/deployments/")) {
      crumbs.push({ label: "Deployments" });
    } else if (pathname.includes("/deployments/")) {
      crumbs.push({ label: "Deployments", to: pathname.replace(/\/deployments\/.*/, "/deployments") });
      crumbs.push({ label: "Detail" });
    } else if (pathname.endsWith("/env-vars")) {
      crumbs.push({ label: "Env Vars" });
    } else if (pathname.endsWith("/settings") && pathname.startsWith("/projects/")) {
      crumbs.push({ label: "Settings" });
    } else if (pathname === "/settings" || pathname.startsWith("/settings/")) {
      const segment = pathname.split("/").pop();
      if (pathname === "/settings") {
        crumbs.push({ label: "Settings", to: "/settings" });
      } else {
        if (crumbs.length === 0 || crumbs[crumbs.length - 1]?.label !== "Settings") {
          crumbs.push({ label: "Settings", to: "/settings" });
        }
        const labels: Record<string, string> = {
          servers: "Servers",
          "git-providers": "Git Providers",
          domains: "Domains",
          backups: "Backups",
          "audit-log": "Audit Log",
        };
        crumbs.push({ label: labels[segment ?? ""] ?? segment ?? "" });
      }
    } else if (pathname === "/team") {
      crumbs.push({ label: "Team" });
    }
  }

  return crumbs;
}

export function BreadcrumbNav() {
  const matches = useMatches();
  const crumbs = buildCrumbs(matches);

  if (crumbs.length === 0) return null;

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, i) => (
          <Fragment key={`${crumb.label}-${i}`}>
            {i > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem>
              {i === crumbs.length - 1 || !crumb.to ? (
                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink href={crumb.to}>{crumb.label}</BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
