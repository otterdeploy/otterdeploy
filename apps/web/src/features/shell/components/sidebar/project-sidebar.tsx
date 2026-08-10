import * as React from "react";

import { HugeiconsIcon } from "@hugeicons/react";
import { useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useRouteContext } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { Project } from "@/routes/_app/layout";

import { projectCollection } from "@/features/projects/data/project";
import { serverCollection } from "@/features/servers/data/server";
import {
  OPERATIONAL_NAV,
  SETTINGS_ENTRY,
  type NavManifestItem,
} from "@/features/shell/nav-manifest";
import { visibleNav } from "@/features/shell/nav-visibility";
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
  SidebarRail,
  SidebarSeparator,
} from "@/shared/components/ui/sidebar";
import { orpc } from "@/shared/server/orpc";

import { NavUser, type User } from "../nav/nav-user";

/**
 * Operational sidebar: the org shell's only navigation column. Groups and
 * items derive from the typed nav manifest (`features/shell/nav-manifest.ts`),
 * the same source the command palette reads, so the two can't drift.
 * A pinned Settings entry at the bottom of the content enters the settings
 * zone (`/$orgSlug/settings/*`), which renders its own chrome. This sidebar
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
  // Server-owned installation authority, resolved once in the `_app`
  // beforeLoad. Install-admin-only destinations are OMITTED for everyone else
  // rather than rendered into a 403. See the manifest's `installAdminOnly`.
  const { isInstallAdmin } = useRouteContext({ from: "/_app" });
  const navGroups = visibleNav(OPERATIONAL_NAV, isInstallAdmin);

  // Live counts shown as menu badges next to Projects / Servers. Both
  // collections are already loaded by the outer `_app` layout's loader,
  // so this hook is a cheap subscription, no extra fetch.
  const { data: projects } = useLiveQuery((q) => q.from({ p: projectCollection }), []);
  const { data: servers } = useLiveQuery((q) => q.from({ s: serverCollection }), []);
  const counts: Record<string, number> = {
    Projects: projects.length,
    Servers: servers.length,
  };

  // Running platform version (the compose image tag the server booted with).
  // `system.version` is install-admin-only, so it isn't even asked for by
  // anyone else: otherwise every page in the shell fired a request that could
  // only 403. `retry: false` covers the admin case where it still fails; the
  // footer simply omits the version instead of showing a fake one.
  const version = useQuery({
    ...orpc.system.version.queryOptions(),
    enabled: isInstallAdmin,
    retry: false,
  });
  const currentVersion = version.data?.current;

  const renderItem = (item: NavManifestItem) => {
    const count = counts[item.title];
    // Manifest paths are typed at their definition; widen to a plain string
    // here so the single dynamic <Link> call site doesn't fight the union's
    // params inference (same loose-`to` overload the sidebar always used).
    const href: string = item.to ?? "/";
    const label = item.i18nKey ? t(item.i18nKey, item.title) : item.title;
    return (
      <SidebarMenuItem key={item.title}>
        <SidebarMenuButton
          // Anchor for the product tour (features/tour/steps.ts). Only the
          // destinations the tour stops at carry one.
          data-tour={item.tourId}
          // Collapsed to the icon rail, the label is clipped and each item is
          // just a glyph. SidebarMenuButton only renders this tooltip while
          // `state === "collapsed"` (and never on mobile), so the expanded
          // sidebar is unaffected. It exists purely to name the icons.
          tooltip={label}
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
          <span>{label}</span>
        </SidebarMenuButton>
        {count !== undefined && count > 0 && <SidebarMenuBadge>{count}</SidebarMenuBadge>}
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar className="top-(--header-height) h-[calc(100svh-var(--header-height))]!" {...props}>
      <SidebarContent>
        {navGroups.map((group) => (
          <SidebarGroup key={group.label ?? group.items[0]?.title ?? "top"}>
            {group.label ? (
              <SidebarGroupLabel className="text-[11px] tracking-wider text-sidebar-foreground/50 uppercase">
                {group.labelI18nKey ? t(group.labelI18nKey, group.label) : group.label}
              </SidebarGroupLabel>
            ) : null}
            <SidebarMenu>{group.items.map(renderItem)}</SidebarMenu>
          </SidebarGroup>
        ))}

        {/* Pinned at the bottom of the CONTENT (above the footer): the single
            entry into the settings zone: account, workspace and instance
            configuration all live behind it. */}
        <SidebarGroup className="mt-auto">
          <SidebarMenu>{renderItem(SETTINGS_ENTRY)}</SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-2">
        <SidebarSeparator />

        <NavUser user={user} />

        {/* Instance summary: real server count + running platform version.
            Pinned below the user, and hidden when the rail is collapsed to icon
            width so its text can't overflow the 3rem column. */}
        <div className="flex items-center gap-2 px-2 pb-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          <span className="min-w-0 flex-1 truncate leading-snug">
            {t("shell.selfHostedServers", { count: servers.length })}
          </span>
          {currentVersion && <span className="shrink-0 font-mono">{currentVersion}</span>}
        </div>
      </SidebarFooter>

      {/* The hairline strip along the sidebar's outer edge, click anywhere on
          it to expand/collapse. Without it the only desktop affordance was the
          Cmd/Ctrl+B shortcut, since the header's toggle is `md:hidden`. */}
      <SidebarRail />
    </Sidebar>
  );
}
