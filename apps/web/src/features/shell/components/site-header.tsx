"use client";

import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useLoaderData, useMatch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { useResourceOverlay } from "@/features/projects/components/new-resource/overlay-provider";
import { HeaderNav } from "@/features/shell/components/header-nav";
import { ModeToggle } from "@/features/shell/components/mode-toggle";
import { UpdateHeaderButton } from "@/features/updates";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Github } from "@/shared/components/ui/svgs/github";

export function SiteHeader() {
  const { t } = useTranslation();
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const projectMatch = useMatch({
    from: "/_app/$orgSlug/$projectSlug",
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
          <div className="relative hidden w-72 sm:block">
            <HugeiconsIcon
              icon={Search01Icon}
              strokeWidth={2}
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              placeholder={t("common.searchOrRun", "Search or run a command...")}
              className="h-8 bg-background pr-9 pl-8"
              aria-label={t("common.search")}
            />
            <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              K
            </kbd>
          </div>

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
