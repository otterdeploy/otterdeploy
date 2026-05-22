import * as React from "react";

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
  SidebarSeparator,
} from "@/shared/components/ui/sidebar";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
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

// ─── data ──────────────────────────────────────────────────────────────────
// Mirrors the helio dashboard demo on feat/v2-rebuild. Hrefs are placeholders
// until per-section routes land; replace anchors with TanStack `Link` then.

type Status = "ok" | "warn" | "err";

const STATUS_DOT: Record<Status, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  err: "bg-rose-500",
};

const environment = { name: "production", status: "ok" as Status };

const project = [
  { title: "Overview", href: "#", icon: Home01Icon },
  { title: "Graph", href: "#", icon: Share08Icon },
  { title: "Deployments", href: "#", icon: Rocket01Icon, badge: "7", active: true },
  { title: "Logs", href: "#", icon: TextAlignLeft01Icon },
  { title: "Metrics", href: "#", icon: ChartHistogramIcon },
  { title: "Variables", href: "#", icon: VariableIcon },
  { title: "Networking", href: "#", icon: EarthIcon },
  { title: "Servers", href: "#", icon: ServerStack01Icon, badge: "3" },
  { title: "Terminal", href: "#", icon: FlashIcon },
  { title: "Settings", href: "#", icon: Sun03Icon },
] as const;

const services = [
  { name: "web", status: "ok" },
  { name: "api", status: "ok" },
  { name: "worker", status: "warn" },
  { name: "postgres", status: "ok" },
  { name: "redis", status: "ok" },
  { name: "imgproxy", status: "ok" },
] as const satisfies ReadonlyArray<{ name: string; status: Status }>;

const region = {
  label: "self-hosted · sf-bay / rack-2",
  version: "v1.4.2-rc.1",
  status: "ok" as Status,
};

const user = { name: "Mira Sato", initials: "MS" };

// ─── helpers ───────────────────────────────────────────────────────────────

function StatusDot({ status, className = "" }: { status: Status; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-2 shrink-0 rounded-full ${STATUS_DOT[status]} ${className}`}
    />
  );
}

// ─── sidebar ───────────────────────────────────────────────────────────────

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar
      className="top-(--header-height) h-[calc(100svh-var(--header-height))]!"
      {...props}
    >
      <SidebarHeader>
        {/* Environment selector — workspace + project shown in top breadcrumb */}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<button type="button" />}
              className="border border-sidebar-border"
            >
              <StatusDot status={environment.status} />
              <span className="flex-1 text-sm text-foreground">{environment.name}</span>
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                strokeWidth={2}
                className="size-4 text-muted-foreground"
              />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] uppercase tracking-wider text-sidebar-foreground/50">Project</SidebarGroupLabel>
          <SidebarMenu>
            {project.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  isActive={"active" in item ? item.active : false}
                  render={<a href={item.href} />}
                >
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

        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] uppercase tracking-wider text-sidebar-foreground/50">Services</SidebarGroupLabel>
          <SidebarGroupAction title="Add service">
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
            <span className="sr-only">Add service</span>
          </SidebarGroupAction>
          <SidebarMenu>
            {services.map((svc) => (
              <SidebarMenuItem key={svc.name}>
                <SidebarMenuButton render={<a href="#" />}>
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
        {/* Region / version */}
        <div className="flex items-start gap-2 px-2 py-1 text-xs text-muted-foreground">
          <StatusDot status={region.status} className="mt-1.5" />
          <span className="flex-1 leading-snug">{region.label}</span>
          <span className="font-mono">{region.version}</span>
        </div>

        <SidebarSeparator />

        {/* User */}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<button type="button" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-md bg-muted text-xs font-medium">
                {user.initials}
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm text-foreground">{user.name}</span>
              </div>
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                strokeWidth={2}
                className="size-4 text-muted-foreground"
              />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
