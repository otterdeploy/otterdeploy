/**
 * State assembly for the project Deployments page. The route component owns
 * navigation (the URL holds ALL page state); this hook derives the view from
 * the URL search, resolves the environment filter against the project's
 * main-env pointer, and runs the list query. Split from the route file to
 * keep the component under the complexity caps.
 */

import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { envCollection } from "@/features/projects/data/env";
import { projectCollection } from "@/features/projects/data/project";
import { resourceCollection } from "@/features/resources/data/resource";
import { isMainEnvironment } from "@/features/shell/environment-default";
import { inActiveEnvironment } from "@/features/shell/environment-scope";
import { type ActiveEnvironment } from "@/features/shell/use-active-environment";
import { orpc } from "@/shared/server/orpc";

import {
  DEFAULT_PAGE_SIZE,
  type DeploymentsSearch,
  type DeployPageSize,
  type DeployStatusFilter,
  type DeployWindow,
  statusFilterToApi,
  windowSince,
} from "../data/deployments-search";

export interface DeploymentsView {
  windowSel: DeployWindow;
  svcFilter: string;
  envFilter: string;
  statusFilter: DeployStatusFilter | "any";
  q: string;
  page: number;
  size: DeployPageSize;
  emptyVariant: "filters" | "window" | "none";
}

/** URL search → the concrete view, all defaults applied in one place. */
export function viewFromSearch(search: DeploymentsSearch): DeploymentsView {
  const windowSel = search.window ?? "7d";
  const q = search.q ?? "";
  const narrowed = Boolean(search.service || search.status || search.environment || q);
  return {
    windowSel,
    svcFilter: search.service ?? "all",
    envFilter: search.environment ?? "all",
    statusFilter: search.status ?? "any",
    q,
    page: search.page ?? 1,
    size: search.size ?? DEFAULT_PAGE_SIZE,
    emptyVariant: narrowed ? "filters" : windowSel !== "all" ? "window" : "none",
  };
}

/** The custom query key's filter segment. Shared with the route's loader so
 *  intent-preloads land under the key the component reads. */
export function deploymentsFilterKey(
  view: Pick<DeploymentsView, "svcFilter" | "statusFilter" | "windowSel" | "q" | "size" | "page">,
  environmentId: string | undefined,
): string {
  return [
    view.svcFilter,
    environmentId ?? "all-env",
    view.statusFilter,
    view.windowSel,
    view.q,
    view.size,
    view.page,
  ].join("|");
}

export function useDeploymentsPage(
  projectId: string,
  activeEnv: ActiveEnvironment,
  search: DeploymentsSearch,
) {
  const view = viewFromSearch(search);

  // Resource filter options: same collection the graph and logs pages read.
  const { data: resources } = useLiveQuery(
    (q) =>
      q
        .from({ r: resourceCollection })
        .where(({ r }) =>
          and(eq(r.projectId, projectId), inActiveEnvironment(r.environmentId, activeEnv)),
        ),
    [projectId, activeEnv.id, activeEnv.isMain],
  );

  // Environment filter options + the project's main-env pointer (needed to
  // scope the query: main additionally owns NULL-stamped rows).
  const { data: environments } = useLiveQuery(
    (q) => q.from({ e: envCollection }).where(({ e }) => eq(e.projectId, projectId)),
    [projectId],
  );
  const { data: projectRow } = useLiveQuery(
    (q) =>
      q
        .from({ p: projectCollection })
        .where(({ p }) => eq(p.id, projectId))
        .findOne(),
    [projectId],
  );

  // A stale environment id in the URL (deleted env, cross-project paste)
  // reads as "all environments" rather than silently filtering to nothing.
  const selectedEnv = environments.find((e) => e.id === search.environment);
  const environmentId = selectedEnv?.id;
  const environmentIsMain =
    selectedEnv !== undefined && isMainEnvironment(selectedEnv, projectRow?.environmentId);

  // Lower bound recomputed only when the window selection changes. A fresh
  // "now" every render would thrash the query input identity.
  const since = windowSince(view.windowSel);

  const query = useQuery({
    ...orpc.deployment.listByProject.queryOptions({
      input: {
        projectId,
        resourceId: search.service,
        status: search.status ? statusFilterToApi(search.status) : undefined,
        environmentId,
        environmentIsMain,
        q: view.q || undefined,
        since,
        limit: view.size,
        offset: (view.page - 1) * view.size,
      },
    }),
    // Key on the *filter selection*, not the resolved input. `since` is
    // derived from "now" on mount, so keying on it would make every return to
    // the route a cache miss (same trick as the audit page). Prefix from the
    // oRPC path (not a hand-typed string) so it stays tied to the procedure.
    queryKey: [
      ...orpc.deployment.listByProject.key(),
      projectId,
      deploymentsFilterKey(view, environmentId),
    ],
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    // Live-ish while the tab is focused; react-query pauses interval refetch
    // for unfocused windows by default.
    refetchInterval: 20_000,
  });

  return {
    view,
    resourceOptions: resources.map((r) => ({ id: r.resourceId, name: r.name, kind: r.type })),
    environmentOptions: environments.map((e) => ({ id: e.id, name: e.name })),
    query,
  };
}
