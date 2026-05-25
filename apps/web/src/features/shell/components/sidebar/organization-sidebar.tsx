import * as React from "react";

import { Link, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

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
  Sun03Icon,
  WebhookIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { NavUser, type User } from "../nav/nav-user";
import { StatusDot, type NavItem, type Status } from "./index";

const navItems = [
  { titleKey: "nav.projects", href: "/$orgSlug", icon: Home01Icon },
  {
    titleKey: "nav.servers",
    href: "/$orgSlug/servers",
    icon: ServerStack01Icon,
    badge: "3",
  },
  {
    titleKey: "nav.networking",
    href: "/$orgSlug/networking",
    icon: EarthIcon,
  },
  { titleKey: "nav.terminal", href: "/$orgSlug/terminal", icon: FlashIcon },
  { titleKey: "nav.settings", href: "/$orgSlug/settings", icon: Sun03Icon },
] as const satisfies ReadonlyArray<NavItem>;

/**
 * Workspace-wide concerns that don't have routes yet — render as plain
 * buttons. Swap to `render={<Link to={...} />}` once their route files land.
 */
type StaticNavItem = {
  title: string;
  icon: typeof Home01Icon;
};

const infrastructureItems: StaticNavItem[] = [
  { title: "Templates", icon: Folder01Icon },
  { title: "Edge logs", icon: EarthIcon },
  { title: "Audit", icon: File01Icon },
  { title: "Docker", icon: ServerStack01Icon },
];

const clusterAdminItems: StaticNavItem[] = [
  { title: "Git providers", icon: GitBranchIcon },
  { title: "Registries", icon: Database02Icon },
  { title: "SSH keys", icon: Key01Icon },
  { title: "Notifications", icon: Alert01Icon },
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

export function OrganizationSidebar({
  user,
  ...props
}: React.ComponentProps<typeof Sidebar> & { user: User }) {
  const { t } = useTranslation();
  // Read the active route's params so we can hand `{ orgSlug }` to each
  // typed Link. `strict: false` makes this safe to call regardless of which
  // nested route is currently matched.
  const params = useParams({ strict: false });
  return (
    <Sidebar
      className="top-(--header-height) h-[calc(100svh-var(--header-height))]!"
      {...props}
    >
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] uppercase tracking-wider text-sidebar-foreground/50">
            {t("nav.workspace")}
          </SidebarGroupLabel>
          <SidebarMenu className="gap-2">
            {navItems.map((item) => (
              <SidebarMenuItem key={item.titleKey}>
                <SidebarMenuButton
                  render={
                    <Link to={item.href} params={params as { orgSlug: string }} />
                  }
                >
                  <HugeiconsIcon icon={item.icon} strokeWidth={2} />
                  <span>{t(item.titleKey)}</span>
                </SidebarMenuButton>
                {"badge" in item && item.badge ? (
                  <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
                ) : null}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] uppercase tracking-wider text-sidebar-foreground/50">
            Infrastructure
          </SidebarGroupLabel>
          <SidebarMenu className="gap-2">
            {infrastructureItems.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton>
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
          <SidebarMenu className="gap-2">
            {clusterAdminItems.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton>
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

        {/* User */}
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
