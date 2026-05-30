import * as React from "react";

import { Link, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { Project } from "@/routes/_app/layout";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
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
  Folder01Icon,
  GitBranchIcon,
  Key01Icon,
  Key02Icon,
  PlusSignIcon,
  ServerStack01Icon,
  Settings01Icon,
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

const infrastructureItems: StaticNavItem[] = [
  { title: "Templates", icon: Folder01Icon },
  { title: "Backups", icon: DatabaseIcon },
  { title: "Volumes", icon: ServerStack01Icon },
  { title: "Edge logs", icon: EarthIcon },
  { title: "Audit", icon: File01Icon },
  { title: "Docker", icon: ServerStack01Icon },
];

const clusterAdminItems: StaticNavItem[] = [
  { title: "Git providers", icon: GitBranchIcon, href: "/$orgSlug/git-providers" },
  { title: "Registries", icon: Database02Icon, href: "/$orgSlug/registries" },
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

const services = [
  { name: "web", status: "ok", href: "/$orgSlug/services/web" },
  { name: "api", status: "ok", href: "/$orgSlug/services/api" },
  { name: "worker", status: "warn", href: "/$orgSlug/services/worker  " },
  { name: "postgres", status: "ok" },
  { name: "redis", status: "ok" },
  { name: "imgproxy", status: "ok" },
] as const satisfies ReadonlyArray<{ name: string; status: Status }>;

/**
 * Workspace sidebar. Holds Services (project-scoped, gated on `project`),
 * Infrastructure, and Cluster admin. Project nav (Overview / Graph /
 * Deployments / …) lives in a horizontal tab row above the page now —
 * see `ProjectTabs`. The env switcher lives in the top `HeaderNav`.
 */
export function ProjectSidebar({
  user,
  project,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user: User;
  project?: Project;
}) {
  const { t } = useTranslation();
  // Org-scoped links use `useParams({ strict: false })` so they resolve
  // their `{ orgSlug }` regardless of which route is currently matched.
  const params = useParams({ strict: false }) as { orgSlug?: string };
  return (
    <Sidebar
      className="top-(--header-height) h-[calc(100svh-var(--header-height))]!"
      {...props}
    >
      <SidebarContent>
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
        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] uppercase tracking-wider text-sidebar-foreground/50">
            Infrastructure
          </SidebarGroupLabel>
          <SidebarMenu>
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
