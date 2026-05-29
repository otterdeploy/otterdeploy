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
  {
    titleKey: "nav.overview",
    href: "/$orgSlug/$projectSlug",
    icon: Home01Icon,
  },
  {
    titleKey: "nav.graph",
    href: "/$orgSlug/$projectSlug/graph",
    icon: Share08Icon,
  },
  {
    titleKey: "nav.deployments",
    href: "/$orgSlug/$projectSlug/deployments",
    icon: Rocket01Icon,
    badge: "7",
    active: true,
  },
  {
    titleKey: "nav.logs",
    href: "/$orgSlug/$projectSlug/logs",
    icon: TextAlignLeft01Icon,
  },
  {
    titleKey: "nav.metrics",
    href: "/$orgSlug/$projectSlug/metrics",
    icon: ChartHistogramIcon,
  },
  {
    titleKey: "nav.variables",
    href: "/$orgSlug/$projectSlug/variables",
    icon: VariableIcon,
  },
  {
    titleKey: "nav.networking",
    href: "/$orgSlug/$projectSlug/networking",
    icon: EarthIcon,
  },
  {
    titleKey: "nav.servers",
    href: "/$orgSlug/$projectSlug/servers",
    icon: ServerStack01Icon,
    badge: "3",
  },
  {
    titleKey: "nav.terminal",
    href: "/$orgSlug/terminal",
    icon: FlashIcon,
  },
  {
    titleKey: "nav.settings",
    href: "/$orgSlug/$projectSlug/settings",
    icon: Sun03Icon,
  },
] as const satisfies ReadonlyArray<NavItem>;

const services = [
  { name: "web", status: "ok", href: "/$orgSlug/services/web" },
  { name: "api", status: "ok", href: "/$orgSlug/services/api" },
  { name: "worker", status: "warn", href: "/$orgSlug/services/worker  " },
  { name: "postgres", status: "ok" },
  { name: "redis", status: "ok" },
  { name: "imgproxy", status: "ok" },
] as const satisfies ReadonlyArray<{ name: string; status: Status }>;

/**
 * Single sidebar for both org-level and project-level routes. Pass
 * `project={undefined}` from the org layout (no project active) — the
 * project-section items are hidden and only the org switcher + footer
 * render. Replaces the old `OrganizationSidebar` so the app has one
 * dashboard shell, not two.
 */
export function ProjectSidebar({
  user,
  project,
  envSlug,
  onEnvSlugChange,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user: User;
  project?: Project;
  envSlug?: string;
  onEnvSlugChange?: (slug: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Sidebar
      className="top-(--header-height) h-[calc(100svh-var(--header-height))]!"
      {...props}
    >
      <SidebarContent>
        {project && (
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
        )}

        {project && (
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
        )}
      </SidebarContent>

      <SidebarFooter className="gap-2">
        {/* User */}
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
