"use client";

import { Breadcrumbs } from "@/features/shell/components/breadcrumbs";
import { useTheme } from "@/shared/components/theme-provider";
import { Button } from "@/shared/components/ui/button";
import { useSidebar } from "@/shared/components/ui/sidebar";
import {
  Moon02Icon,
  Notification01Icon,
  Search01Icon,
  SidebarLeftIcon,
  Sun03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useLoaderData } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export function SiteHeader() {
  const { toggleSidebar } = useSidebar();
  const { workspace } = useLoaderData({ from: "/_app/$workspaceId" });
  const { resolvedTheme, setTheme } = useTheme();
  const { t } = useTranslation();

  const isDark = resolvedTheme === "dark";

  return (
    <header className="sticky top-0 z-50 flex w-full items-center border-b bg-background">
      <div className="flex h-(--header-height) w-full items-center gap-3 px-3">
        <Button
          className="size-8"
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          aria-label={t("common.openSidebar")}
        >
          <HugeiconsIcon icon={SidebarLeftIcon} strokeWidth={2} />
        </Button>

        {/*<Link
          to="/$workspaceId"
          params={{ workspaceId: workspace.id }}
          className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent"
        >
          <span className="flex size-5 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background">
            {workspace.name.charAt(0).toLowerCase()}
          </span>
          <span className="font-medium">{workspace.name}</span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            strokeWidth={2}
            className="size-3.5 text-muted-foreground"
          />
        </Link>*/}

        <Breadcrumbs className="hidden md:block" />

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            className="hidden h-8 gap-2 px-2 text-muted-foreground sm:inline-flex"
            aria-label={t("common.search")}
          >
            <HugeiconsIcon
              icon={Search01Icon}
              strokeWidth={2}
              className="size-4"
            />
            <span className="text-sm">{t("common.search")}</span>
            <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              ⌘K
            </kbd>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t("common.notifications")}
          >
            <HugeiconsIcon
              icon={Notification01Icon}
              strokeWidth={2}
              className="size-4"
            />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            aria-label={t("common.toggleTheme")}
          >
            <HugeiconsIcon
              icon={isDark ? Sun03Icon : Moon02Icon}
              strokeWidth={2}
              className="size-4"
            />
          </Button>
        </div>
      </div>
    </header>
  );
}
