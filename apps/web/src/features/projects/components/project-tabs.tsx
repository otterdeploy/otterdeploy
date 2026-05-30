import { Link, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { cn } from "@/shared/lib/utils";
import type { RoutePath } from "@/features/shell/components/sidebar";

interface Tab {
  titleKey: string;
  to: RoutePath;
  /** True only for the index route — TanStack's exact match opt-in. */
  exact?: boolean;
}

const tabs: readonly Tab[] = [
  { titleKey: "nav.overview", to: "/$orgSlug/$projectSlug", exact: true },
  { titleKey: "nav.graph", to: "/$orgSlug/$projectSlug/graph" },
  { titleKey: "nav.deployments", to: "/$orgSlug/$projectSlug/deployments" },
  { titleKey: "nav.logs", to: "/$orgSlug/$projectSlug/logs" },
  { titleKey: "nav.metrics", to: "/$orgSlug/$projectSlug/metrics" },
  { titleKey: "nav.variables", to: "/$orgSlug/$projectSlug/variables" },
  { titleKey: "nav.networking", to: "/$orgSlug/$projectSlug/networking" },
  { titleKey: "nav.settings", to: "/$orgSlug/$projectSlug/settings" },
] as const;

/**
 * Horizontal nav for the project shell — Overview / Graph / Deployments /
 * Logs / etc. Renders below the top `SiteHeader`, above the page content.
 * Replaces the old vertical Project group in `ProjectSidebar`.
 */
export function ProjectTabs() {
  const { t } = useTranslation();
  const { orgSlug, projectSlug } = useParams({
    from: "/_app/$orgSlug/$projectSlug",
  });

  return (
    <nav
      aria-label="Project"
      className="sticky top-(--header-height) z-30 flex h-10 items-center gap-0.5 overflow-x-auto border-b bg-background px-3"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          params={{ orgSlug, projectSlug }}
          activeOptions={tab.exact ? { exact: true } : undefined}
          className={cn(
            "shrink-0 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors",
            "hover:bg-accent hover:text-foreground",
            "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          )}
          activeProps={{
            className: "bg-accent text-foreground font-medium",
          }}
        >
          {t(tab.titleKey)}
        </Link>
      ))}
    </nav>
  );
}
