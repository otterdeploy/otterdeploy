import * as React from "react";

import { Link } from "@tanstack/react-router";

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
  EarthIcon,
  FlashIcon,
  Home01Icon,
  ServerStack01Icon,
  Sun03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { NavUser, type User } from "../nav/nav-user";
import { StatusDot, type NavItem, type Status } from "./index";

const workspace = [
  { title: "Projects", href: "/$workspaceId", icon: Home01Icon },
  {
    title: "Servers",
    href: "/$workspaceId/servers",
    icon: ServerStack01Icon,
    badge: "3",
  },
  {
    title: "Networking",
    href: "/$workspaceId/networking",
    icon: EarthIcon,
  },
  { title: "Terminal", href: "/$workspaceId/terminal", icon: FlashIcon },
  { title: "Settings", href: "/$workspaceId/settings", icon: Sun03Icon },
] as const satisfies ReadonlyArray<NavItem>;

const region = {
  label: "self-hosted · sf-bay / rack-2",
  version: "v1.4.2-rc.1",
  status: "ok" as Status,
};

export function WorkspaceSidebar({
  user,
  ...props
}: React.ComponentProps<typeof Sidebar> & { user: User }) {
  return (
    <Sidebar
      className="top-(--header-height) h-[calc(100svh-var(--header-height))]!"
      {...props}
    >
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] uppercase tracking-wider text-sidebar-foreground/50">
            Project
          </SidebarGroupLabel>
          <SidebarMenu className="gap-2">
            {workspace.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton render={<Link to={item.href} />}>
                  <HugeiconsIcon icon={item.icon} strokeWidth={2} />
                  <span>{item.title}</span>
                </SidebarMenuButton>
                {"badge" in item && item.badge ? (
                  <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
                ) : null}
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
