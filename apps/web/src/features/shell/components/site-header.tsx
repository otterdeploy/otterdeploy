"use client";

import { Add01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useLoaderData, useMatch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { ActivityIndicator } from "@/features/activity/activity-indicator";
import { setCommandPaletteOpen } from "@/features/command-palette/hooks/use-command-palette";
import { NotificationInboxPopover } from "@/features/notifications/inbox-popover";
import { useResourceOverlay } from "@/features/projects/components/new-resource/overlay-provider";
import { HeaderNav } from "@/features/shell/components/header-nav";
import { ModeToggle } from "@/features/shell/components/mode-toggle";
import { OtterdeployMark } from "@/shared/components/brand/otterdeploy-logo";
import { Button } from "@/shared/components/ui/button";
import { SidebarTrigger } from "@/shared/components/ui/sidebar";
import { useAppStatus } from "@/shared/lib/app-status";

export function SiteHeader() {
  const { t } = useTranslation();
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const projectMatch = useMatch({
    from: "/_app/$orgSlug/_shell/$projectSlug",
    shouldThrow: false,
  });
  const project = projectMatch?.loaderData?.project;
  // Single, provider-owned wizard dialog (mounted in ResourceOverlayProvider).
  // The header just asks it to open — no second dialog instance with its own
  // state to drift out of sync.
  const overlay = useResourceOverlay();
  const status = useAppStatus();

  return (
    <header className="z-50 flex w-full items-center border-b bg-background">
      <div className="flex h-12 w-full min-w-0 items-center gap-2 px-3">
        {/* Below `md` the sidebar is an off-canvas Sheet whose only other
            opener is Cmd/Ctrl+B — unreachable on a touch device. Without this
            trigger the entire nav column is inaccessible on a phone. */}
        <SidebarTrigger className="-ml-1 shrink-0 md:hidden" />

        <Link
          to="/$orgSlug"
          params={{ orgSlug: organization.slug }}
          className="flex shrink-0 items-center"
          // The label overrides the mark's own, so it has to carry the state
          // too — otherwise a deploy is visible but never announced.
          aria-label={status === "idle" ? "otterdeploy home" : `otterdeploy home — ${status}`}
        >
          {/* Same rollup the tab shows, so the mark reads identically whether
              this window is focused or sitting in the background. */}
          <OtterdeployMark size={24} status={status} />
        </Link>

        <HeaderNav />

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          {/* The full search field needs ~18rem it doesn't have on a phone, so
              below `sm` it collapses to an icon button onto the same palette. */}
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            aria-label={t("common.search")}
            className="hidden h-8 w-56 items-center gap-2 rounded-md border bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:inline-flex lg:w-72"
          >
            <HugeiconsIcon icon={Search01Icon} strokeWidth={2} className="size-4" />
            <span className="flex-1 truncate text-left">
              {t("common.searchOrRun", "Search or run a command...")}
            </span>
            <kbd className="pointer-events-none rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              K
            </kbd>
          </button>

          <Button
            variant="ghost"
            size="icon"
            aria-label={t("common.search")}
            onClick={() => setCommandPaletteOpen(true)}
            className="sm:hidden"
          >
            <HugeiconsIcon icon={Search01Icon} strokeWidth={2} className="size-4" />
          </Button>

          {/* Left of the bell, and self-hiding when idle: present state first,
              then unread history. Two controls, one question each. */}
          <ActivityIndicator orgSlug={organization.slug} />

          <NotificationInboxPopover orgSlug={organization.slug} />

          <ModeToggle />

          {project && (
            <>
              <Button className="hidden h-8 sm:inline-flex" onClick={() => overlay.setOpen(true)}>
                + New service
              </Button>
              {/* Same action, icon-only — the label alone is wider than the
                  space left beside the notification and theme controls. */}
              <Button
                size="icon"
                aria-label="New service"
                onClick={() => overlay.setOpen(true)}
                className="sm:hidden"
              >
                <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-4" />
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
