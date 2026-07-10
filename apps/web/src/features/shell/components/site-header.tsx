"use client";

import { Notification03Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useLoaderData, useMatch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { setCommandPaletteOpen } from "@/features/command-palette/hooks/use-command-palette";
import { useResourceOverlay } from "@/features/projects/components/new-resource/overlay-provider";
import { HeaderNav } from "@/features/shell/components/header-nav";
import { ModeToggle } from "@/features/shell/components/mode-toggle";
import { UpdateHeaderButton } from "@/features/updates";
import { Button } from "@/shared/components/ui/button";

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

  return (
    <header className="sticky top-0 z-50 flex w-full items-center border-b bg-background">
      <div className="flex h-(--header-height) w-full items-center gap-2 px-3">
        <Link
          to="/$orgSlug"
          params={{ orgSlug: organization.slug }}
          className="flex shrink-0 items-center"
          aria-label="otterdeploy home"
        >
          <span className="grid size-7 place-items-center rounded-md bg-foreground text-[11px] font-semibold text-background lowercase">
            os
          </span>
        </Link>

        <HeaderNav />

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            aria-label={t("common.search")}
            className="hidden h-8 w-72 items-center gap-2 rounded-md border bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:inline-flex"
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
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label={t("common.notifications")}
            render={
              <Link
                to="/$orgSlug/settings/workspace/notifications"
                params={{ orgSlug: organization.slug }}
              />
            }
          >
            <HugeiconsIcon icon={Notification03Icon} strokeWidth={2} className="size-[1.1rem]" />
          </Button>

          <ModeToggle />

          <UpdateHeaderButton />

          {project && (
            <Button className="h-8" onClick={() => overlay.setOpen(true)}>
              + New service
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
