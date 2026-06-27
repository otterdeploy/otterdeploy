import * as React from "react";

import {
  Alert01Icon,
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
  ShieldKeyIcon,
  Sun03Icon,
  UserMultipleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useLiveQuery } from "@tanstack/react-db";
import { Link, useParams } from "@tanstack/react-router";

import type { Project } from "@/routes/_app/layout";

import { projectCollection } from "@/features/projects/data/project";
import { serverCollection } from "@/features/servers/data/server";
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

import { NavUser, type User } from "../nav/nav-user";
import { StatusDot, type Status } from "./index";

interface StaticNavItem {
  title: string;
  icon: typeof Folder01Icon;
  href?: string;
}

interface NavGroup {
  label: string;
  items: StaticNavItem[];
}

// Grouped by the noun the user is reasoning about, ordered most- to
// least-frequently accessed. Every item links to a real route; the `href`
// stays optional on the type so a future not-yet-built page can be added back
// as a non-clickable placeholder. Keep this in sync with the command palette's
// `ORG_NAV_GROUPS` in command-palette/.../nav-items.tsx.
const navGroups: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { title: "Projects", icon: Home01Icon, href: "/$orgSlug" },
      { title: "Servers", icon: ServerStack01Icon, href: "/$orgSlug/servers" },
      { title: "Terminal", icon: FlashIcon, href: "/$orgSlug/terminal" },
    ],
  },
  {
    label: "Networking & Edge",
    items: [
      { title: "Networking", icon: EarthIcon, href: "/$orgSlug/networking" },
      { title: "Edge logs", icon: EarthIcon, href: "/$orgSlug/edge-logs" },
      { title: "Firewall", icon: ShieldKeyIcon, href: "/$orgSlug/firewall" },
    ],
  },
  {
    label: "Data & Runtime",
    items: [
      { title: "Backups", icon: DatabaseIcon, href: "/$orgSlug/backups" },
      { title: "Docker", icon: ServerStack01Icon, href: "/$orgSlug/docker" },
      { title: "Registries", icon: Database02Icon, href: "/$orgSlug/registries" },
    ],
  },
  {
    label: "Observability",
    items: [
      { title: "Platform", icon: FlashIcon, href: "/$orgSlug/platform" },
      { title: "Audit", icon: File01Icon, href: "/$orgSlug/audit" },
    ],
  },
  {
    label: "Integrations",
    items: [
      { title: "Git providers", icon: GitBranchIcon, href: "/$orgSlug/git-providers" },
      { title: "Notifications", icon: Alert01Icon, href: "/$orgSlug/notifications" },
    ],
  },
  {
    label: "Organization",
    items: [
      { title: "Team", icon: UserMultipleIcon, href: "/$orgSlug/team" },
      { title: "API tokens", icon: Key02Icon, href: "/$orgSlug/api-keys" },
      { title: "SSH keys", icon: Key01Icon, href: "/$orgSlug/ssh-keys" },
      { title: "Settings", icon: Sun03Icon, href: "/$orgSlug/settings" },
    ],
  },
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
  const { data: projects } = useLiveQuery((q) => q.from({ p: projectCollection }), []);
  const { data: servers } = useLiveQuery((q) => q.from({ s: serverCollection }), []);
  const workspaceCounts: Record<string, number> = {
    Projects: projects.length,
    Servers: servers.length,
  };
  return (
    <Sidebar className="top-(--header-height) h-[calc(100svh-var(--header-height))]!" {...props}>
      <SidebarContent>
        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="text-[11px] tracking-wider text-sidebar-foreground/50 uppercase">
              {group.label}
            </SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((item) => {
                const count = workspaceCounts[item.title];
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      render={
                        item.href && params.orgSlug ? (
                          <Link
                            to={item.href}
                            params={{ orgSlug: params.orgSlug }}
                            activeOptions={{ exact: item.href === "/$orgSlug" }}
                            activeProps={{ "data-active": "" }}
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
        ))}
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
