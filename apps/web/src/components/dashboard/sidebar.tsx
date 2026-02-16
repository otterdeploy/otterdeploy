import { Link, useMatches } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  DashboardSquare02Icon,
  Settings02Icon,
  UserGroupIcon,
  HierarchyCircle02Icon,
  Rocket01Icon,
  Key01Icon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@otterstack/ui/components/ui/sidebar";

import { OrgSwitcher } from "./org-switcher";

type NavItem = {
  label: string;
  to: string;
  icon: IconSvgElement;
};

type ProjectNavItem = {
  label: string;
  segment: string;
  icon: IconSvgElement;
};

const mainNav: NavItem[] = [
  { label: "Dashboard", to: "/dashboard", icon: DashboardSquare02Icon },
  { label: "Settings", to: "/settings", icon: Settings02Icon },
  { label: "Team", to: "/team", icon: UserGroupIcon },
];

const projectNav: ProjectNavItem[] = [
  { label: "Architecture", segment: "architecture", icon: HierarchyCircle02Icon },
  { label: "Deployments", segment: "deployments", icon: Rocket01Icon },
  { label: "Env Vars", segment: "env-vars", icon: Key01Icon },
  { label: "Settings", segment: "settings", icon: Wrench01Icon },
];

export function AppSidebar() {
  const matches = useMatches();
  const projectMatch = matches.find((m) =>
    m.pathname.startsWith("/projects/") && m.pathname.split("/").length >= 3,
  );
  const projectId = projectMatch
    ? projectMatch.pathname.split("/")[2]
    : null;

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <OrgSwitcher />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    render={<Link to={item.to} />}
                    tooltip={item.label}
                  >
                    <HugeiconsIcon icon={item.icon} strokeWidth={2} className="size-4" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {projectId && (
          <SidebarGroup>
            <SidebarGroupLabel>Project</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {projectNav.map((item) => (
                  <SidebarMenuItem key={item.segment}>
                    <SidebarMenuButton
                      render={
                        <Link
                          to={`/projects/${projectId}/${item.segment}`}
                        />
                      }
                      tooltip={item.label}
                    >
                      <HugeiconsIcon icon={item.icon} strokeWidth={2} className="size-4" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter />
    </Sidebar>
  );
}
