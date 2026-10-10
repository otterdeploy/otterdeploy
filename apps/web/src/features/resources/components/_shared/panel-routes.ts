/**
 * The resource panel's routes, and opening one from inside a project.
 *
 * A panel tab is a path segment under `/projects/$project/$env/r/$resource`,
 * so every place that opens a panel names the tab by route. The table lives
 * here, beside the panel, so the route layout and the in-panel links (stack
 * members, the breadcrumb, the switcher) agree on it.
 */
import { useMatches, useNavigate, useParams } from "@tanstack/react-router";

import { FALLBACK_ENV_SLUG } from "@/features/shell/environment-default";

/** Every panel tab's route. */
const PANEL_TAB_PATHS = {
  overview: "/$orgSlug/projects/$projectSlug/$envSlug/r/$resourceId",
  deployments: "/$orgSlug/projects/$projectSlug/$envSlug/r/$resourceId/deployments",
  logs: "/$orgSlug/projects/$projectSlug/$envSlug/r/$resourceId/logs",
  variables: "/$orgSlug/projects/$projectSlug/$envSlug/r/$resourceId/variables",
  settings: "/$orgSlug/projects/$projectSlug/$envSlug/r/$resourceId/settings",
  metrics: "/$orgSlug/projects/$projectSlug/$envSlug/r/$resourceId/metrics",
  terminal: "/$orgSlug/projects/$projectSlug/$envSlug/r/$resourceId/terminal",
  data: "/$orgSlug/projects/$projectSlug/$envSlug/r/$resourceId/data",
  compose: "/$orgSlug/projects/$projectSlug/$envSlug/r/$resourceId/compose",
} as const;

export const PANEL_LOG_PATHS = {
  runtime: "/$orgSlug/projects/$projectSlug/$envSlug/r/$resourceId/logs",
  build: "/$orgSlug/projects/$projectSlug/$envSlug/r/$resourceId/logs/build",
  deploy: "/$orgSlug/projects/$projectSlug/$envSlug/r/$resourceId/logs/deploy",
} as const;

/** A tab's route. A tab the table doesn't know opens the panel's index, where
 *  the panel falls back to its own default. */
export function panelTabPath(tab: string | undefined) {
  switch (tab) {
    case "deployments":
    case "logs":
    case "variables":
    case "settings":
    case "metrics":
    case "terminal":
    case "data":
    case "compose":
      return PANEL_TAB_PATHS[tab];
    default:
      return PANEL_TAB_PATHS.overview;
  }
}

/**
 * Open another resource's panel in the project and environment on screen.
 *
 * `keepTab` carries the open tab across (Logs → Logs) when moving between
 * members of one stack; the deployment a tab had focused belongs to the old
 * resource and is dropped. `replace` keeps one history entry per open: Back
 * closes the panel rather than walking every resource you looked at.
 */
export function useOpenResource() {
  const navigate = useNavigate();
  const { orgSlug, projectSlug, envSlug } = useParams({ strict: false });
  const tab = useMatches({ select: (matches) => matches.at(-1)?.staticData.view?.[0] });

  return (resourceId: string, opts: { keepTab?: boolean; replace?: boolean } = {}) => {
    if (!orgSlug || !projectSlug) return;
    void navigate({
      to: panelTabPath(opts.keepTab ? tab : undefined),
      params: { orgSlug, projectSlug, envSlug: envSlug ?? FALLBACK_ENV_SLUG, resourceId },
      replace: opts.replace,
    });
  };
}

/** The open panel tab (the first level of the leaf route's `view`), and the
 *  environment segment the panel sits in. For links that keep both. */
export function usePanelRouteContext(): { tab: string | undefined; envSlug: string } {
  const { envSlug } = useParams({ strict: false });
  const tab = useMatches({ select: (matches) => matches.at(-1)?.staticData.view?.[0] });
  return { tab, envSlug: envSlug ?? FALLBACK_ENV_SLUG };
}
