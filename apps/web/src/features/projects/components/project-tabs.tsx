import { useLayoutEffect, useRef, useState } from "react";

import { Link, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { RoutePath } from "@/features/shell/components/sidebar";

import { cn } from "@/shared/lib/utils";

/**
 * Only the project-scoped routes — those carrying both `$orgSlug` and
 * `$projectSlug` path params. Narrowing `to` to this subset lets TanStack
 * statically resolve the `params` object below; the broad `RoutePath`
 * union can't tell which params a given `to` requires.
 */
type ProjectRoutePath = Extract<RoutePath, `/$orgSlug/$projectSlug${string}`>;

interface Tab {
  titleKey: string;
  /** Anchor for the product tour, rendered as `data-tour`. */
  tourId?: string;
  to: ProjectRoutePath;
  /** True only for the index route — TanStack's exact match opt-in. */
  exact?: boolean;
  /** Default label when the i18n key isn't defined yet. */
  fallback?: string;
}

const tabs: readonly Tab[] = [
  // No "Overview" tab: the project index route redirects straight to
  // /graph (the graph IS the project overview), so an Overview entry here
  // would never actually activate — clicking it lands on Graph with the
  // Graph tab highlighted instead. See routes/.../$projectSlug/index.tsx.
  { titleKey: "nav.graph", to: "/$orgSlug/$projectSlug/graph" },
  {
    titleKey: "nav.deployments",
    to: "/$orgSlug/$projectSlug/deployments",
    tourId: "project-tab-deployments",
    fallback: "Deployments",
  },
  {
    titleKey: "nav.logs",
    to: "/$orgSlug/$projectSlug/logs",
    tourId: "project-tab-logs",
  },
  { titleKey: "nav.metrics", to: "/$orgSlug/$projectSlug/metrics" },
  {
    titleKey: "nav.variables",
    to: "/$orgSlug/$projectSlug/variables",
    tourId: "project-tab-variables",
  },
  {
    titleKey: "nav.networking",
    to: "/$orgSlug/$projectSlug/networking",
    tourId: "project-tab-networking",
  },
  // No "Edge logs" tab (od-u63.5) — merged into Logs as a Runtime | Edge
  // source toggle (see $projectSlug/logs.tsx). The route still exists as a
  // redirect shim for old links.
  { titleKey: "nav.settings", to: "/$orgSlug/$projectSlug/settings" },
] as const;

/**
 * Horizontal nav for the project shell — Graph / Deployments / Logs / etc.
 * Renders below the top `SiteHeader`, above the page content.
 * Sliding underline tracks the active route via the same measure-active
 * pattern the shadcn `TabsList variant="line"` uses (ResizeObserver +
 * MutationObserver on `data-active`), reimplemented here because the
 * shadcn one is Base UI–controlled (value-based) and these tabs are
 * route-based (TanStack Link).
 */
export function ProjectTabs() {
  const { t } = useTranslation();
  const { orgSlug, projectSlug } = useParams({
    from: "/_app/$orgSlug/_shell/$projectSlug",
  });

  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  });

  useLayoutEffect(() => {
    const node = listRef.current;
    if (!node) return;

    const update = () => {
      const active = node.querySelector<HTMLElement>("[data-active]");
      if (active) {
        const left = active.offsetLeft;
        const width = active.offsetWidth;
        setIndicator({ left, width });
        // Seven tabs don't fit a phone, so this row scrolls. Keep the active
        // one visible — landing on Settings from the command palette otherwise
        // shows a strip scrolled to Graph with no visible selection. Scoped to
        // this container's scrollLeft on purpose (not `scrollIntoView`, which
        // would drag every ancestor scroller along with it).
        if (left < node.scrollLeft) {
          node.scrollLeft = left;
        } else if (left + width > node.scrollLeft + node.clientWidth) {
          node.scrollLeft = left + width - node.clientWidth;
        }
      }
    };
    update();

    // Width changes (font load, viewport resize) and active-tab changes
    // (route nav) both shift the indicator's target geometry.
    const ro = new ResizeObserver(update);
    ro.observe(node);
    const mo = new MutationObserver(update);
    mo.observe(node, {
      attributes: true,
      attributeFilter: ["data-active"],
      subtree: true,
    });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  return (
    <nav aria-label="Project" className="sticky top-(--header-height) z-30 border-b bg-background">
      <div
        ref={listRef}
        className="relative no-scrollbar flex h-10 items-center gap-0.5 overflow-x-auto overflow-y-hidden px-3"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            data-tour={tab.tourId}
            params={{ orgSlug, projectSlug }}
            activeOptions={tab.exact ? { exact: true } : undefined}
            className={cn(
              "shrink-0 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors",
              "hover:text-foreground",
              "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            )}
            activeProps={{
              "data-active": "",
              className: "text-foreground font-medium",
            }}
          >
            {t(tab.titleKey, tab.fallback ? { defaultValue: tab.fallback } : undefined)}
          </Link>
        ))}
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-px h-0.5 rounded-full bg-foreground transition-[left,width] duration-300 ease-out"
          style={{ left: indicator.left, width: indicator.width }}
        />
      </div>
    </nav>
  );
}
