import type { TranslationKey } from "@otterdeploy/i18n";

import { useLayoutEffect, useRef, useState } from "react";

import { Link, useLoaderData, useMatch, useMatchRoute, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { FALLBACK_ENV_SLUG } from "@/features/shell/environment-default";
import { useActiveEnvironment } from "@/features/shell/use-active-environment";
import { cn } from "@/shared/lib/utils";

/**
 * The project's tabs. Graph, Deployments, Logs, Metrics and Networking are
 * per environment (`/projects/$p/$env/…`); Variables opens the
 * cross-environment matrix and Settings is project-wide. Each `to` is a
 * literal so TanStack checks it against the route tree.
 */
type Tab = {
  titleKey: TranslationKey;
  /** Anchor for the product tour, rendered as `data-tour`. */
  tourId?: string;
  /** Default label when the i18n key isn't defined yet. */
  fallback?: string;
} & (
  | {
      scope: "environment";
      to:
        | "/$orgSlug/projects/$projectSlug/$envSlug"
        | "/$orgSlug/projects/$projectSlug/$envSlug/deployments"
        | "/$orgSlug/projects/$projectSlug/$envSlug/logs"
        | "/$orgSlug/projects/$projectSlug/$envSlug/metrics"
        | "/$orgSlug/projects/$projectSlug/$envSlug/networking";
    }
  | {
      scope: "project";
      to: "/$orgSlug/projects/$projectSlug/variables" | "/$orgSlug/projects/$projectSlug/settings";
    }
);

const tabs: readonly Tab[] = [
  // The graph IS the project overview (live resource + pending-change nodes),
  // so there is no separate Overview tab.
  { titleKey: "nav.graph", scope: "environment", to: "/$orgSlug/projects/$projectSlug/$envSlug" },
  {
    titleKey: "nav.deployments",
    scope: "environment",
    to: "/$orgSlug/projects/$projectSlug/$envSlug/deployments",
    tourId: "project-tab-deployments",
    fallback: "Deployments",
  },
  {
    titleKey: "nav.logs",
    scope: "environment",
    to: "/$orgSlug/projects/$projectSlug/$envSlug/logs",
    tourId: "project-tab-logs",
  },
  // No "Analytics" tab: traffic analytics is a TOP-LEVEL page
  // (/monitoring/analytics). Most edge traffic on an install belongs to no
  // project (the control-plane dashboard above all), so a project-nested view
  // could only show a slice.
  {
    titleKey: "nav.metrics",
    scope: "environment",
    to: "/$orgSlug/projects/$projectSlug/$envSlug/metrics",
  },
  {
    titleKey: "nav.variables",
    scope: "project",
    to: "/$orgSlug/projects/$projectSlug/variables",
    tourId: "project-tab-variables",
  },
  {
    titleKey: "nav.networking",
    scope: "environment",
    to: "/$orgSlug/projects/$projectSlug/$envSlug/networking",
    tourId: "project-tab-networking",
  },
  // Edge logs are a source of Logs (`/logs/edge`), not a tab.
  { titleKey: "nav.settings", scope: "project", to: "/$orgSlug/projects/$projectSlug/settings" },
] as const;

/**
 * Horizontal nav for the project shell: Graph / Deployments / Logs / etc.
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
    from: "/_app/$orgSlug/_shell/projects/$projectSlug",
  });
  const { project } = useLoaderData({ from: "/_app/$orgSlug/_shell/projects/$projectSlug" });
  // The environment the operator is looking at: the one in the path, or the
  // project's default on its index. Every per-environment tab keeps it, so a
  // tab click never dumps them back on main while the header still names the
  // environment they thought they were in.
  const envSlug = useActiveEnvironment(project.id).slug ?? FALLBACK_ENV_SLUG;
  // Graph is active on the whole canvas (the project index, an environment,
  // an open resource or preview), not on every page under `/$env`. Variables
  // is active on the matrix and on one environment's table.
  const onCanvas = Boolean(
    useMatch({ from: "/_app/$orgSlug/_shell/projects/$projectSlug/_canvas", shouldThrow: false }),
  );
  const matchRoute = useMatchRoute();
  const onEnvVariables = Boolean(
    matchRoute({ to: "/$orgSlug/projects/$projectSlug/$envSlug/variables", fuzzy: true }),
  );

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
        // one visible, landing on Settings from the command palette otherwise
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
        {tabs.map((tab) => {
          const forced =
            tab.to === "/$orgSlug/projects/$projectSlug/$envSlug"
              ? onCanvas
              : tab.to === "/$orgSlug/projects/$projectSlug/variables"
                ? onEnvVariables || undefined
                : undefined;
          return (
            <Link
              key={tab.to}
              data-tour={tab.tourId}
              {...(tab.scope === "environment"
                ? { to: tab.to, params: { orgSlug, projectSlug, envSlug } }
                : { to: tab.to, params: { orgSlug, projectSlug } })}
              {...(forced === undefined ? {} : forced ? { "data-active": "" } : {})}
              activeOptions={
                tab.to === "/$orgSlug/projects/$projectSlug/$envSlug" ? { exact: true } : undefined
              }
              className={cn(
                "shrink-0 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors",
                "hover:text-foreground",
                "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                forced && "font-medium text-foreground",
              )}
              activeProps={{
                "data-active": "",
                className: "text-foreground font-medium",
              }}
            >
              {tab.fallback === undefined
                ? t(tab.titleKey)
                : t(tab.titleKey, { defaultValue: tab.fallback })}
            </Link>
          );
        })}
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-px h-0.5 rounded-full bg-foreground transition-[left,width] duration-300 ease-out"
          style={{ left: indicator.left, width: indicator.width }}
        />
      </div>
    </nav>
  );
}
