import { useEffect } from "react";

import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { SETTINGS_NAV } from "@/features/shell/nav-manifest";

/**
 * Settings zone — a Linear-style takeover for everything that is
 * configuration rather than operation. Own left rail, NO org sidebar,
 * NO SidebarProvider (the shadcn provider registers ⌘B and writes the
 * `sidebar_state` cookie unconditionally — a second instance would corrupt
 * both). The rail is a plain styled column driven by the nav manifest.
 *
 * Exits: the "Back to app" affordance in the header, or Esc anywhere
 * (unless focus is in an editable element or an overlay is open).
 */
export const Route = createFileRoute("/_app/$orgSlug/settings")({
  staticData: { crumb: "Settings" },
  component: SettingsZoneLayout,
});

/** True when Esc should be left to the focused element / open overlay. */
function escBelongsElsewhere(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return true;
  const target = event.target as HTMLElement | null;
  if (
    target?.closest(
      "input, textarea, select, [contenteditable='true'], [contenteditable='']",
    )
  ) {
    return true;
  }
  // Any open popup layer (dialog, alert, menu, combobox listbox) owns Esc.
  return Boolean(
    document.querySelector(
      "[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox']",
    ),
  );
}

function SettingsZoneLayout() {
  const { t } = useTranslation();
  const { orgSlug } = Route.useParams();
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || escBelongsElsewhere(event)) return;
      void navigate({ to: "/$orgSlug", params: { orgSlug } });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, orgSlug]);

  return (
    <div className="flex min-h-svh flex-col bg-background">
      {/* Zone header: exit affordance + zone title. */}
      <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center gap-3 border-b bg-background px-3">
        <Link
          to="/$orgSlug"
          params={{ orgSlug }}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} className="size-4" />
          {t("settings.backToApp", "Back to app")}
        </Link>
        <span aria-hidden className="h-4 w-px bg-border" />
        <h1 className="text-[13px] font-semibold text-foreground">
          {t("nav.settings", "Settings")}
        </h1>
        <kbd className="ml-auto hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-block">
          esc
        </kbd>
      </header>

      <div className="flex flex-1">
        {/* Rail: a plain styled column — deliberately NOT the shadcn Sidebar. */}
        <nav
          aria-label={t("nav.settings", "Settings")}
          className="sticky top-12 hidden h-[calc(100svh-3rem)] w-52 shrink-0 flex-col gap-5 overflow-y-auto border-r px-3 py-4 md:flex"
        >
          {SETTINGS_NAV.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <span className="px-2 text-[11px] tracking-wider text-muted-foreground/70 uppercase">
                {group.label}
              </span>
              {group.items.map((item) => {
                // Manifest paths are typed at their definition; widen to a
                // plain string at this dynamic call site (see sidebar).
                const href: string = item.to ?? "/";
                return (
                  <Link
                    key={`${group.label}-${item.title}`}
                    to={href}
                    params={{ orgSlug }}
                    activeProps={{ "data-active": "" }}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-active:bg-accent data-active:font-medium data-active:text-foreground"
                  >
                    <HugeiconsIcon icon={item.icon} strokeWidth={2} className="size-4 shrink-0" />
                    {item.i18nKey ? t(item.i18nKey, item.title) : item.title}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <main className="flex min-w-0 flex-1 flex-col">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
