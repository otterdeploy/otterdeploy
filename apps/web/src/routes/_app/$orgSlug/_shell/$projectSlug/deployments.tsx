/**
 * Project-wide deployments list: every build/deploy across the project's
 * resources, newest first. THE URL HOLDS ALL PAGE STATE: filters (resource /
 * environment / status / time window), free-text search, and pagination
 * (page + rows-per-page) all live in search params, so any view is shareable
 * and survives reload. Rows link to the existing deployment detail route;
 * in-flight rows expose an icon cancel, eligible history rows an icon Roll
 * back behind a styled confirm. Data comes from `deployment.listByProject`
 * (which also returns the stats strip's aggregate) with a 20s refetch while
 * the tab is focused. State assembly lives in
 * features/deployments/hooks/use-deployments-page.ts.
 */

import { createFileRoute, useLoaderData, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { DeploymentsStats } from "@/features/deployments/components/deployments-stats";
import { DeploymentsTableSection } from "@/features/deployments/components/deployments-table";
import { DeploymentsToolbar } from "@/features/deployments/components/deployments-toolbar";
import { RollbackDialog } from "@/features/deployments/components/rollback-dialog";
import {
  DEFAULT_PAGE_SIZE,
  type DeploymentsSearch,
  type ProjectDeployment,
  statusFilterToApi,
  windowSince,
  zDeploymentsSearch,
} from "@/features/deployments/data/deployments-search";
import {
  deploymentsFilterKey,
  useDeploymentsPage,
  viewFromSearch,
} from "@/features/deployments/hooks/use-deployments-page";
import { projectIdBySlug } from "@/features/projects/data/project";
import { logTabForStatus } from "@/features/resources/lib/deployment-log-tab";
import { useActiveEnvironment } from "@/features/shell/use-active-environment";
import { Page, PageHeader } from "@/shared/components/page";
import { orpc, queryClient } from "@/shared/server/orpc";

import type { DeploymentTab } from "./graph/$resourceId/deployment/-components/deployment-tabs";

export const Route = createFileRoute("/_app/$orgSlug/_shell/$projectSlug/deployments")({
  staticData: { crumb: "Deployments" },
  validateSearch: zDeploymentsSearch,
  // Warm the deployments list on hover (intent-preload) under the SAME custom
  // key the component reads (see useDeploymentsPage), so a visit renders from
  // cache instead of spinning. Non-blocking + best-effort. `loaderDeps` pulls
  // the filter search params through so the preloaded entry matches the URL.
  loaderDeps: ({ search }) => ({ ...search }),
  loader: ({ params, deps }) => {
    const projectId = projectIdBySlug(params.projectSlug);
    if (!projectId) return;
    // An environment filter needs the project's main-env pointer to scope
    // correctly, which the loader doesn't have. Skip the warm-up rather than
    // caching wrongly-scoped rows under the component's key.
    if (deps.environment) return;
    const view = viewFromSearch(deps);
    void queryClient
      .prefetchQuery({
        ...orpc.deployment.listByProject.queryOptions({
          input: {
            projectId,
            resourceId: deps.service,
            status: deps.status ? statusFilterToApi(deps.status) : undefined,
            q: deps.q,
            since: windowSince(view.windowSel),
            limit: view.size,
            offset: (view.page - 1) * view.size,
          },
        }),
        queryKey: [
          ...orpc.deployment.listByProject.key(),
          projectId,
          deploymentsFilterKey(view, undefined),
        ],
      })
      .catch(() => undefined);
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { project } = useLoaderData({ from: "/_app/$orgSlug/_shell/$projectSlug" });
  const activeEnv = useActiveEnvironment(project.id);
  const { orgSlug, projectSlug } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const rootNavigate = useNavigate();

  const { view, resourceOptions, environmentOptions, query } = useDeploymentsPage(
    project.id,
    activeEnv,
    search,
  );

  // Replace (not push) so filter changes don't spam the back-stack; the URL
  // still reflects the current view for sharing / reload. Any filter change
  // also resets pagination: page 3 of the previous filter is meaningless.
  const patchSearch = (patch: Partial<DeploymentsSearch>, opts?: { keepPage?: boolean }) => {
    void navigate({
      search: (prev) => ({ ...prev, ...(opts?.keepPage ? {} : { page: undefined }), ...patch }),
      replace: true,
    });
  };

  const items: ProjectDeployment[] = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const stats = query.data?.stats;

  const [rollbackTarget, setRollbackTarget] = useState<ProjectDeployment | null>(null);

  const openDetail = (d: ProjectDeployment, deploymentTab: DeploymentTab = "details") => {
    void rootNavigate({
      to: "/$orgSlug/$projectSlug/graph/$resourceId/deployment/$deploymentId",
      params: {
        orgSlug,
        projectSlug,
        resourceId: d.resourceId,
        deploymentId: d.id,
      },
      search: { deploymentTab, tab: "deployments" },
    });
  };

  return (
    <Page>
      <PageHeader
        title="Deployments"
        description="Every build and deploy across this project's resources, newest first."
      />

      <DeploymentsToolbar
        resources={resourceOptions}
        environments={environmentOptions}
        q={view.q}
        onQChange={(v) => patchSearch({ q: v || undefined })}
        service={view.svcFilter}
        onServiceChange={(v) => patchSearch({ service: v === "all" ? undefined : v })}
        environment={view.envFilter}
        onEnvironmentChange={(v) => patchSearch({ environment: v === "all" ? undefined : v })}
        status={view.statusFilter}
        onStatusChange={(v) => patchSearch({ status: v === "any" ? undefined : v })}
        window={view.windowSel}
        onWindowChange={(v) => patchSearch({ window: v === "7d" ? undefined : v })}
      />

      {stats && <DeploymentsStats stats={stats} window={view.windowSel} />}

      <DeploymentsTableSection
        items={items}
        total={total}
        page={view.page}
        size={view.size}
        isLoading={query.isLoading}
        isError={query.isError}
        isFetching={query.isFetching}
        errorMessage={query.error?.message}
        emptyVariant={view.emptyVariant}
        onRetry={() => void query.refetch()}
        onOpen={(d) => openDetail(d)}
        onViewLogs={(d) => openDetail(d, logTabForStatus(d.status))}
        onRollback={setRollbackTarget}
        onPageChange={(next) =>
          patchSearch({ page: next === 1 ? undefined : next }, { keepPage: true })
        }
        onSizeChange={(next) =>
          patchSearch({ size: next === DEFAULT_PAGE_SIZE ? undefined : next })
        }
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
