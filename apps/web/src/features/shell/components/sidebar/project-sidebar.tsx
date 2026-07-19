import * as React from "react";

import { HugeiconsIcon } from "@hugeicons/react";
import { useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { Project } from "@/routes/_app/layout";

import { projectCollection } from "@/features/projects/data/project";
import { serverCollection } from "@/features/servers/data/server";
import {
  OPERATIONAL_NAV,
  SETTINGS_ENTRY,
  type NavManifestItem,
} from "@/features/shell/nav-manifest";
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
import { orpc } from "@/shared/server/orpc";

import { NavUser, type User } from "../nav/nav-user";

/**
 * Operational sidebar — the org shell's only navigation column. Groups and
 * items derive from the typed nav manifest (`features/shell/nav-manifest.ts`),
 * the same source the command palette reads, so the two can't drift.
 * A pinned Settings entry at the bottom of the content enters the settings
 * zone (`/$orgSlug/settings/*`), which renders its own chrome — this sidebar
 * is never mounted there.
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
  const { t } = useTranslation();
  // Org-scoped links use `useParams({ strict: false })` so they resolve
  // their `{ orgSlug }` regardless of which route is currently matched.
  const params = useParams({ strict: false }) as { orgSlug?: string };

  // Live counts shown as menu badges next to Projects / Servers. Both
  // collections are already loaded by the outer `_app` layout's loader,
  // so this hook is a cheap subscription — no extra fetch.
  const { data: projects } = useLiveQuery((q) => q.from({ p: projectCollection }), []);
  const { data: servers } = useLiveQuery((q) => q.from({ s: serverCollection }), []);
  const counts: Record<string, number> = {
    Projects: projects.length,
    Servers: servers.length,
  };

  // Running platform version (the compose image tag the server booted with).
  // Needs `platform:read` — a plain member gets a 403, so `retry: false` and
  // the footer simply omits the version instead of showing a fake one.
  const version = useQuery({ ...orpc.system.version.queryOptions(), retry: false });
  const currentVersion = version.data?.current;

  const renderItem = (item: NavManifestItem) => {
    const count = counts[item.title];
    // Manifest paths are typed at their definition; widen to a plain string
    // here so the single dynamic <Link> call site doesn't fight the union's
    // params inference (same loose-`to` overload the sidebar always used).
    const href: string = item.to ?? "/";
    return (
      <SidebarMenuItem key={item.title}>
        <SidebarMenuButton
          render={
            params.orgSlug ? (
              <Link
                to={href}
                params={{ orgSlug: params.orgSlug }}
                activeOptions={{ exact: item.exact === true }}
                activeProps={{ "data-active": "" }}
              />
            ) : undefined
          }
        >
          <HugeiconsIcon icon={item.icon} strokeWidth={2} />
          <span>{item.i18nKey ? t(item.i18nKey, item.title) : item.title}</span>
        </SidebarMenuButton>
        {count !== undefined && count > 0 && <SidebarMenuBadge>{count}</SidebarMenuBadge>}
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar className="top-(--header-height) h-[calc(100svh-var(--header-height))]!" {...props}>
      <SidebarContent>
        {OPERATIONAL_NAV.map((group) => (
          <SidebarGroup key={group.label ?? group.items[0]?.title ?? "top"}>
            {group.label ? (
              <SidebarGroupLabel className="text-[11px] tracking-wider text-sidebar-foreground/50 uppercase">
                {group.label}
              </SidebarGroupLabel>
            ) : null}
            <SidebarMenu>{group.items.map(renderItem)}</SidebarMenu>
          </SidebarGroup>
        ))}

        {/* Pinned at the bottom of the CONTENT (above the footer): the single
            entry into the settings zone — account, workspace and instance
            configuration all live behind it. */}
        <SidebarGroup className="mt-auto">
          <SidebarMenu>{renderItem(SETTINGS_ENTRY)}</SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-2">
        <SidebarSeparator />

        <NavUser user={user} />

        {/* Instance summary — real server count + running platform version.
            Pinned below the user, and hidden when the rail is collapsed to icon
            width so its text can't overflow the 3rem column. */}
        <div className="flex items-center gap-2 px-2 pb-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          <span className="min-w-0 flex-1 truncate leading-snug">
            self-hosted · {servers.length} {servers.length === 1 ? "server" : "servers"}
          </span>
          {currentVersion && <span className="shrink-0 font-mono">{currentVersion}</span>}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
