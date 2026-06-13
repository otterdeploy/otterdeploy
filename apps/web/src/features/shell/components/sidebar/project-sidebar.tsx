import * as React from "react";

import { useLiveQuery } from "@tanstack/react-db";
import { Link, useParams } from "@tanstack/react-router";

import { projectCollection } from "@/features/projects/data/project";
import { serverCollection } from "@/features/servers/data/server";
import type { Project } from "@/routes/_app/layout";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/shared/components/ui/sidebar";
import {
  Alert01Icon,
  Certificate01Icon,
  Database02Icon,
  DatabaseIcon,
  EarthIcon,
  File01Icon,
  FlashIcon,
  Folder01Icon,
  GitBranchIcon,
  Home01Icon,
  Key01Icon,
  Key02Icon,
  ServerStack01Icon,
  Settings01Icon,
  ShieldKeyIcon,
  Sun03Icon,
  UserMultipleIcon,
  WebhookIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { NavUser, type User } from "../nav/nav-user";
import { StatusDot, type Status } from "./index";

interface StaticNavItem {
  title: string;
  icon: typeof Folder01Icon;
  href?: string;
}

const workspaceItems: StaticNavItem[] = [
  { title: "Projects", icon: Home01Icon, href: "/$orgSlug" },
  { title: "Servers", icon: ServerStack01Icon, href: "/$orgSlug/servers" },
  { title: "Networking", icon: EarthIcon, href: "/$orgSlug/networking" },
  { title: "Terminal", icon: FlashIcon, href: "/$orgSlug/terminal" },
  { title: "Team", icon: UserMultipleIcon, href: "/$orgSlug/team" },
  { title: "Settings", icon: Sun03Icon, href: "/$orgSlug/settings" },
];

const infrastructureItems: StaticNavItem[] = [
  { title: "Templates", icon: Folder01Icon },
  { title: "Backups", icon: DatabaseIcon, href: "/$orgSlug/backups" },
  { title: "Volumes", icon: ServerStack01Icon },
  { title: "Edge logs", icon: EarthIcon, href: "/$orgSlug/edge-logs" },
  { title: "Audit", icon: File01Icon, href: "/$orgSlug/audit" },
  { title: "Docker", icon: ServerStack01Icon, href: "/$orgSlug/docker" },
];

const clusterAdminItems: StaticNavItem[] = [
  { title: "Firewall", icon: ShieldKeyIcon, href: "/$orgSlug/firewall" },
  { title: "Git providers", icon: GitBranchIcon, href: "/$orgSlug/git-providers" },
  { title: "Registries", icon: Database02Icon, href: "/$orgSlug/registries" },
  { title: "SSH keys", icon: Key01Icon },
  { title: "Notifications", icon: Alert01Icon, href: "/$orgSlug/notifications" },
  { title: "Certificates", icon: Certificate01Icon },
  { title: "API tokens", icon: Key02Icon },
  { title: "Webhooks", icon: WebhookIcon },
  { title: "Cluster", icon: Settings01Icon },
];

const region = {
  label: "self-hosted · sf-bay / rack-2",
  version: "v1.4.2-rc.1",
  status: "ok" as Status,
};

/**
 * Workspace sidebar. Three groups: Workspace (org-scoped pages —
 * Projects list, Servers, Networking, Terminal, Settings),
 * Infrastructure, Cluster admin. Project nav (Overview / Graph /
 * Deployments / …) lives in a horizontal tab row above the page —
 * see `ProjectTabs`. Services live on the Overview page itself.
 * The env switcher lives in the top `HeaderNav`. The `project` prop
 * is unused right now but kept on the signature so the project layout
 * can keep passing it for future project-scoped sidebar groups.
 */
export function ProjectSidebar({
  user,
  // biome-ignore lint/correctness/noUnusedFunctionParameters: kept for forward-compat with project-scoped groups
  project: _project,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user: User;
  project?: Project;
}) {
  // Org-scoped links use `useParams({ strict: false })` so they resolve
  // their `{ orgSlug }` regardless of which route is currently matched.
  const params = useParams({ strict: false }) as { orgSlug?: string };

  // Live counts shown as menu badges next to Projects / Servers. Both
  // collections are already loaded by the outer `_app` layout's loader,
  // so this hook is a cheap subscription — no extra fetch.
  const { data: projects = [] } = useLiveQuery(
    (q) => q.from({ p: projectCollection }),
    [],
  );
  const { data: servers = [] } = useLiveQuery(
    (q) => q.from({ s: serverCollection }),
    [],
  );
  const workspaceCounts: Record<string, number> = {
    Projects: projects.length,
    Servers: servers.length,
  };
  return (
    <Sidebar
      className="top-(--header-height) h-[calc(100svh-var(--header-height))]!"
      {...props}
    >
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] uppercase tracking-wider text-sidebar-foreground/50">
            Workspace
          </SidebarGroupLabel>
          <SidebarMenu>
            {workspaceItems.map((item) => {
              const count = workspaceCounts[item.title];
              return (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    render={
                      item.href && params.orgSlug ? (
                        <Link
                          to={item.href}
                          params={{ orgSlug: params.orgSlug }}
                        />
                      ) : undefined
                    }
                  >
                    <HugeiconsIcon icon={item.icon} strokeWidth={2} />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                  {count !== undefined && count > 0 && (
                    <SidebarMenuBadge>{count}</SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] uppercase tracking-wider text-sidebar-foreground/50">
            Infrastructure
          </SidebarGroupLabel>
          <SidebarMenu>
            {infrastructureItems.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  render={
                    item.href && params.orgSlug ? (
                      <Link
                        to={item.href}
                        params={{ orgSlug: params.orgSlug }}
                      />
                    ) : undefined
                  }
                >
                  <HugeiconsIcon icon={item.icon} strokeWidth={2} />
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] uppercase tracking-wider text-sidebar-foreground/50">
            Cluster admin
          </SidebarGroupLabel>
          <SidebarMenu>
            {clusterAdminItems.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  render={
                    item.href && params.orgSlug ? (
                      <Link
                        to={item.href}
                        params={{ orgSlug: params.orgSlug }}
                      />
                    ) : undefined
                  }
                >
                  <HugeiconsIcon icon={item.icon} strokeWidth={2} />
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-2">
        {/* Region / version */}
        <div className="flex items-start gap-2 px-2 py-1 text-xs text-muted-foreground">
          <StatusDot status={region.status} className="mt-1.5" />
          <span className="flex-1 leading-snug">{region.label}</span>
          <span className="font-mono">{region.version}</span>
        </div>

        <SidebarSeparator />

        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
