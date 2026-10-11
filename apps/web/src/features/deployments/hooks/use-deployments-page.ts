/**
 * State assembly for the project Deployments page. The route owns navigation
 * (the URL holds every filter); this hook turns the URL into a scope, reads
 * that scope's collection and summary, and narrows the rows to the status
 * view, all through the same grouping the server counts with.
 */

import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";

import { envCollection } from "@/features/projects/data/env";
import { resourceCollection } from "@/features/resources/data/resource";
import { inActiveEnvironment } from "@/features/shell/environment-scope";
import { type ActiveEnvironment } from "@/features/shell/use-active-environment";

import type { DeploymentsSearch, ServingDeployment, StatusView } from "../data/deployments-search";

import { deploymentsMetaOptions, projectDeploymentsCollection } from "../data/project-deployments";
import { scopeFromSearch, scopeText } from "../model/deployments-scope";
import { inStatusView, statusViewCounts } from "../model/deployments-view";

export function useDeploymentsPage(
  projectId: string,
  activeEnv: ActiveEnvironment,
  search: DeploymentsSearch,
) {
  const view: StatusView = search.status ?? "all";
  const scope = scopeFromSearch(projectId, activeEnv, search);

  // Resource options: the same collection the graph and logs pages read.
  const { data: resources } = useLiveQuery(
    (q) =>
      q
        .from({ r: resourceCollection })
        .where(({ r }) =>
          and(eq(r.projectId, projectId), inActiveEnvironment(r.environmentId, activeEnv)),
        ),
    [projectId, activeEnv.id, activeEnv.isMain],
  );
  const { data: environments } = useLiveQuery(
    (q) => q.from({ e: envCollection }).where(({ e }) => eq(e.projectId, projectId)),
    [projectId],
  );

  const collection = projectDeploymentsCollection(scope);
  const live = useLiveQuery(
    (q) => q.from({ d: collection }).orderBy(({ d }) => d.createdAt, "desc"),
    [collection],
  );
  const meta = useQuery(deploymentsMetaOptions(scope));

  const all = live.data ?? [];
  const rows = all.filter((d) => inStatusView(d, view));
  const servingByResource = new Map<string, ServingDeployment>(
    (meta.data?.serving ?? []).map((s) => [s.resourceId, s]),
  );

  const resourceName = resources.find((r) => r.resourceId === search.resource)?.name;

  const envName =
    environments.find((e) => e.id === activeEnv.id)?.name ?? activeEnv.slug ?? "this project";

  return {
    view,
    scope,
    scopeKey: collection.id,
    scopeText: scopeText(scope, resourceName),
    envName,
    resourceOptions: resources.map((r) => ({ id: r.resourceId, name: r.name })),
    rows,
    heldCount: all.length,
    meta: meta.data,
    counts: meta.data ? statusViewCounts(meta.data.stats) : null,
    servingByResource,
    isLoading: live.isLoading || meta.data === undefined,
    isError: live.isError,
    refetch: () => void collection.utils.refetch(),
  };
}
