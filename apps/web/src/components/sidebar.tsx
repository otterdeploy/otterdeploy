import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Server,
  FolderKanban,
  Rocket,
  Settings,
  LogOut,
} from "lucide-react";

import { authClient } from "@/lib/auth-client";
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
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

const navItems = [
  {
    title: "Dashboard",
    href: "/dashboard" as const,
    icon: LayoutDashboard,
    disabled: false,
  },
  {
    title: "Servers",
    icon: Server,
    disabled: true,
    badge: "Phase 2",
  },
  {
    title: "Projects",
    icon: FolderKanban,
    disabled: true,
    badge: "Phase 3",
  },
  {
    title: "Deployments",
    icon: Rocket,
    disabled: true,
    badge: "Phase 4",
  },
  {
    title: "Settings",
    icon: Settings,
    disabled: true,
    badge: "Soon",
  },
];

export function AppSidebar() {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1">
          <div className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md text-xs font-bold">
            O
          </div>
          <span className="text-lg font-semibold">OtterStack</span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  {item.disabled ? (
                    <SidebarMenuButton disabled>
                      <item.icon className="size-4" />
                      <span>{item.title}</span>
                      {"badge" in item && item.badge && (
                        <span className="text-muted-foreground ml-auto text-[10px]">
                          {item.badge}
                        </span>
                      )}
                    </SidebarMenuButton>
                  ) : (
                    <SidebarMenuButton
                      isActive={currentPath.startsWith(item.href!)}
                    >
                      <Link to={item.href!} className="flex items-center gap-2">
                        <item.icon className="size-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <Button
          variant="ghost"
          className="w-full justify-start gap-2"
          onClick={async () => {
            await authClient.signOut();
            window.location.href = "/login";
          }}
        >
          <LogOut className="size-4" />
          Sign out
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
