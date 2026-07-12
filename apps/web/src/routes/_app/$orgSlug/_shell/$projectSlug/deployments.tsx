/**
 * Project-wide deployments list — every build/deploy across the project's
 * resources, commit-first, newest first. Filters (resource / status / time
 * window) live in the URL so a view is shareable; rows link to the existing
 * deployment detail route; eligible history rows expose a hover Roll back
 * behind a styled confirm. Data comes from `deployment.listByProject` with
 * the audit page's "N of M · Load more" growing-limit pagination and a
 * 20s refetch while the tab is focused.
 */

import { eq, useLiveQuery } from "@tanstack/react-db";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, useLoaderData, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DeploymentsTableSection } from "@/features/deployments/components/deployments-table";
import { DeploymentsToolbar } from "@/features/deployments/components/deployments-toolbar";
import { RollbackDialog } from "@/features/deployments/components/rollback-dialog";
import {
  type DeploymentsSearch,
  type ProjectDeployment,
  statusFilterToApi,
  windowSince,
  zDeploymentsSearch,
} from "@/features/deployments/data/deployments-search";
import { resourceCollection } from "@/features/resources/data/resource";
import { Page, PageHeader } from "@/shared/components/page";
import { orpc } from "@/shared/server/orpc";

const PAGE_SIZE = 50;

export const Route = createFileRoute("/_app/$orgSlug/_shell/$projectSlug/deployments")({
  staticData: { crumb: "Deployments" },
  validateSearch: zDeploymentsSearch,
  component: RouteComponent,
});

function RouteComponent() {
  const { project } = useLoaderData({ from: "/_app/$orgSlug/_shell/$projectSlug" });
  const { orgSlug, projectSlug } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const rootNavigate = useNavigate();

  // Replace (not push) so filter changes don't spam the back-stack; the URL
  // still reflects the current view for sharing / reload.
  const patchSearch = useCallback(
    (patch: Partial<DeploymentsSearch>) => {
      void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
    },
    [navigate],
  );

  // Resource filter options — same collection the graph and logs pages read.
  const { data: resources } = useLiveQuery(
    (q) => q.from({ r: resourceCollection }).where(({ r }) => eq(r.projectId, project.id)),
    [project.id],
  );
  const resourceOptions = useMemo(
    () => resources.map((r) => ({ id: r.resourceId as string, name: r.name, kind: r.type })),
    [resources],
  );

  const windowSel = search.window ?? "7d";
  const svcFilter = search.service ?? "all";
  const statusFilter = search.status ?? "any";

  // Growing-limit pagination (audit idiom); reset when the filter set changes.
  const [limit, setLimit] = useState(PAGE_SIZE);
  const filterKey = `${svcFilter}|${statusFilter}|${windowSel}`;
  useEffect(() => setLimit(PAGE_SIZE), [filterKey]);

  // Lower bound recomputed only when the window selection changes — a fresh
  // "now" every render would thrash the query input identity.
  const since = useMemo(() => windowSince(windowSel), [windowSel]);

  const query = useQuery({
    ...orpc.deployment.listByProject.queryOptions({
      input: {
        projectId: project.id,
        resourceId: search.service,
        status: search.status ? statusFilterToApi(search.status) : undefined,
        since,
        limit,
      },
    }),
    // Key on the *filter selection*, not the resolved input — `since` is
    // derived from "now" on mount, so keying on it would make every return to
    // the route a cache miss (same trick as the audit page).
    queryKey: ["project-deployments", project.id, filterKey, limit],
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    // Live-ish while the tab is focused; react-query pauses interval refetch
    // for unfocused windows by default.
    refetchInterval: 20_000,
  });

  const items: ProjectDeployment[] = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  const [rollbackTarget, setRollbackTarget] = useState<ProjectDeployment | null>(null);

  const openDetail = useCallback(
    (d: ProjectDeployment) => {
      void rootNavigate({
        to: "/$orgSlug/$projectSlug/graph/$resourceId/deployment/$deploymentId",
        params: {
          orgSlug,
          projectSlug: projectSlug as never,
          resourceId: d.resourceId,
          deploymentId: d.id,
        },
        search: { tab: "details" },
      });
    },
    [rootNavigate, orgSlug, projectSlug],
  );

  const emptyVariant =
    search.service || search.status ? "filters" : windowSel !== "all" ? "window" : "none";

  return (
    <Page>
      <PageHeader
        title="Deployments"
        description="Every build and deploy across this project's resources — newest first."
      />

      <DeploymentsToolbar
        resources={resourceOptions}
        service={svcFilter}
        onServiceChange={(v) => patchSearch({ service: v === "all" ? undefined : v })}
        status={statusFilter}
        onStatusChange={(v) => patchSearch({ status: v === "any" ? undefined : v })}
        window={windowSel}
        onWindowChange={(v) => patchSearch({ window: v === "7d" ? undefined : v })}
      />

      <DeploymentsTableSection
        items={items}
        total={total}
        isLoading={query.isLoading}
        isError={query.isError}
        isFetching={query.isFetching}
        errorMessage={query.error?.message}
        emptyVariant={emptyVariant}
        onRetry={() => void query.refetch()}
        onOpen={openDetail}
        onRollback={setRollbackTarget}
        onLoadMore={() => setLimit((l) => l + PAGE_SIZE)}
      />

      <RollbackDialog
        target={rollbackTarget}
        projectId={project.id}
        onClose={() => setRollbackTarget(null)}
        onRolledBack={() => void query.refetch()}
      />
    </Page>
  );
}
