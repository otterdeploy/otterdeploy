import { Link, useParams } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/shared/lib/utils";
import type { RoutePath } from "@/features/shell/components/sidebar";

interface Tab {
  titleKey: string;
  to: RoutePath;
  /** True only for the index route — TanStack's exact match opt-in. */
  exact?: boolean;
  /** Default label when the i18n key isn't defined yet. */
  fallback?: string;
}

const tabs: readonly Tab[] = [
  { titleKey: "nav.overview", to: "/$orgSlug/$projectSlug", exact: true },
  { titleKey: "nav.graph", to: "/$orgSlug/$projectSlug/graph" },
  { titleKey: "nav.deployments", to: "/$orgSlug/$projectSlug/deployments" },
  { titleKey: "nav.logs", to: "/$orgSlug/$projectSlug/logs" },
  { titleKey: "nav.metrics", to: "/$orgSlug/$projectSlug/metrics" },
  { titleKey: "nav.variables", to: "/$orgSlug/$projectSlug/variables" },
  { titleKey: "nav.networking", to: "/$orgSlug/$projectSlug/networking" },
  {
    titleKey: "nav.edgeLogs",
    to: "/$orgSlug/$projectSlug/edge-logs",
    fallback: "Edge logs",
  },
  { titleKey: "nav.settings", to: "/$orgSlug/$projectSlug/settings" },
] as const;

/**
 * Horizontal nav for the project shell — Overview / Graph / Deployments /
 * Logs / etc. Renders below the top `SiteHeader`, above the page content.
 * Sliding underline tracks the active route via the same measure-active
 * pattern the shadcn `TabsList variant="line"` uses (ResizeObserver +
 * MutationObserver on `data-active`), reimplemented here because the
 * shadcn one is Base UI–controlled (value-based) and these tabs are
 * route-based (TanStack Link).
 */
export function ProjectTabs() {
  const { t } = useTranslation();
  const { orgSlug, projectSlug } = useParams({
    from: "/_app/$orgSlug/$projectSlug",
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
      const active = node.querySelector("[data-active]");
      if (active) {
        setIndicator({ left: active.offsetLeft, width: active.offsetWidth });
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
    <nav
      aria-label="Project"
      className="sticky top-(--header-height) z-30 border-b bg-background"
    >
      <div
        ref={listRef}
        className="relative flex h-10 items-center gap-0.5 overflow-x-auto px-3 overflow-y-hidden"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
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
            {t(
              tab.titleKey,
              tab.fallback ? { defaultValue: tab.fallback } : undefined,
            )}
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
