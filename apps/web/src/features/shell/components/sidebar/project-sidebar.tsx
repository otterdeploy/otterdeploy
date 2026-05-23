import * as React from "react";

import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { Project } from "@/routes/_app/layout";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/components/ui/sidebar";
import {
  ChartHistogramIcon,
  EarthIcon,
  FlashIcon,
  Home01Icon,
  PlusSignIcon,
  Rocket01Icon,
  ServerStack01Icon,
  Share08Icon,
  Sun03Icon,
  TextAlignLeft01Icon,
  VariableIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { NavUser, type User } from "../nav/nav-user";
import { EnvironmentSelector } from "./environment-selector";
import { StatusDot, type NavItem, type Status } from "./index";

const navItems = [
  { titleKey: "nav.overview", href: "/$workspaceId/$projectId", icon: Home01Icon },
  { titleKey: "nav.graph", href: "/$workspaceId/$projectId/graph", icon: Share08Icon },
  {
    titleKey: "nav.deployments",
    href: "/$workspaceId/$projectId/deployments",
    icon: Rocket01Icon,
    badge: "7",
    active: true,
  },
  {
    titleKey: "nav.logs",
    href: "/$workspaceId/$projectId/logs",
    icon: TextAlignLeft01Icon,
  },
  {
    titleKey: "nav.metrics",
    href: "/$workspaceId/$projectId/metrics",
    icon: ChartHistogramIcon,
  },
  {
    titleKey: "nav.variables",
    href: "/$workspaceId/$projectId/variables",
    icon: VariableIcon,
  },
  {
    titleKey: "nav.networking",
    href: "/$workspaceId/$projectId/networking",
    icon: EarthIcon,
  },
  {
    titleKey: "nav.servers",
    href: "/$workspaceId/$projectId/servers",
    icon: ServerStack01Icon,
    badge: "3",
  },
  {
    titleKey: "nav.terminal",
    href: "/$workspaceId/$projectId/terminal",
    icon: FlashIcon,
  },
  {
    titleKey: "nav.settings",
    href: "/$workspaceId/$projectId/settings",
    icon: Sun03Icon,
  },
] as const satisfies ReadonlyArray<NavItem>;

const services = [
  { name: "web", status: "ok", href: "/$workspaceId/services/web" },
  { name: "api", status: "ok", href: "/$workspaceId/services/api" },
  { name: "worker", status: "warn", href: "/$workspaceId/services/worker  " },
  { name: "postgres", status: "ok" },
  { name: "redis", status: "ok" },
  { name: "imgproxy", status: "ok" },
] as const satisfies ReadonlyArray<{ name: string; status: Status }>;

export function ProjectSidebar({
  user,
  project,
  envSlug,
  onEnvSlugChange,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user: User;
  project: Project;
  envSlug?: string;
  onEnvSlugChange: (slug: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Sidebar
      className="top-(--header-height) h-[calc(100svh-var(--header-height))]!"
      {...props}
    >
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <EnvironmentSelector
              environments={project.environments}
              value={envSlug}
              onValueChange={onEnvSlugChange}
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] uppercase tracking-wider text-sidebar-foreground/50">
            {t("nav.project")}
          </SidebarGroupLabel>
          <SidebarMenu>
            {navItems.map((item) => (
              <SidebarMenuItem key={item.titleKey}>
                <SidebarMenuButton render={<Link to={item.href} />}>
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
          <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-sidebar-foreground/50">
            {t("nav.services")}
          </SidebarGroupLabel>
          <SidebarGroupAction title={t("nav.addService")}>
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
            <span className="sr-only">{t("nav.addService")}</span>
          </SidebarGroupAction>
          <SidebarMenu>
            {services.map((svc) => (
              <SidebarMenuItem key={svc.name}>
                <SidebarMenuButton render={<Link to="." />}>
                  <HugeiconsIcon icon={ServerStack01Icon} strokeWidth={2} />
                  <span className="font-mono">{svc.name}</span>
                  <StatusDot status={svc.status} className="ml-auto" />
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-2">
        {/* User */}
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
