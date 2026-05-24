"use client";

import { useState } from "react";
import {
  Link,
  useLoaderData,
  useMatch,
} from "@tanstack/react-router";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { Breadcrumbs } from "@/features/shell/components/breadcrumbs";
import { ModeToggle } from "@/features/shell/components/mode-toggle";
import { NewResourceOverlayDialog } from "@/features/projects/components/new-resource/new-resource-dialogs";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Github } from "@/shared/components/ui/svgs/github";
import { ID_PREFIX, type Slug } from "@otterstack/shared/id";

export function SiteHeader() {
  const { t } = useTranslation();
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const projectMatch = useMatch({
    from: "/_app/$orgSlug/$projectSlug",
    shouldThrow: false,
  });
  const project = projectMatch?.loaderData?.project;

  const [overlayOpen, setOverlayOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 flex w-full items-center border-b bg-muted">
      <div className="flex h-(--header-height) w-full items-center gap-3 px-3">
        <Link
          to="/$orgSlug"
          params={{ orgSlug: organization.slug }}
          className="flex shrink-0 items-center gap-2"
          aria-label="otterstack home"
        >
          <span className="grid size-7 place-items-center rounded-md bg-foreground text-[11px] font-semibold lowercase text-background">
            os
          </span>
          <span className="text-sm font-medium">otterstack</span>
        </Link>

        <Breadcrumbs className="hidden md:block" />

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
              className="h-8 bg-background pl-8 pr-9"
              aria-label={t("common.search")}
            />
            <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              K
            </kbd>
          </div>

          <ModeToggle />

          <Button variant="outline" className="h-8 gap-2">
            <Github className="size-4" />
            Connect
          </Button>

          {project && (
            <Button className="h-8" onClick={() => setOverlayOpen(true)}>
              + New service
            </Button>
          )}
        </div>
      </div>

      {project && (
        <NewResourceOverlayDialog
          orgSlug={organization.slug}
          projectSlug={project.slug as Slug<typeof ID_PREFIX.project>}
          projectName={project.name}
          open={overlayOpen}
          onOpenChange={setOverlayOpen}
        />
      )}
    </header>
  );
}
