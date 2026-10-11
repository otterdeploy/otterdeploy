/**
 * Project deployments: every deploy in the active environment, as ONE list,
 * and which one each resource is serving. The status control (All · Live now
 * · In progress · Failed) narrows the list rather than adding a second
 * section; the serving row says "Live" in every view. THE URL HOLDS ALL PAGE
 * STATE, so any view is a link that survives reload. Rows come from a
 * TanStack DB collection the deploy event streams keep live (see
 * features/deployments/data/project-deployments.ts); assembly lives in
 * features/deployments/hooks/use-deployments-page.ts.
 */

import { createFileRoute, useLoaderData, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import {
  DeploymentsBody,
  DeploymentsFilters,
  isNeverDeployed,
} from "@/features/deployments/components/deployments-page-parts";
import { RollbackDialog } from "@/features/deployments/components/rollback-dialog";
import {
  type DeploymentsSearch,
  type ProjectDeployment,
  zDeploymentsSearch,
} from "@/features/deployments/data/deployments-search";
import { useDeploymentRowActions } from "@/features/deployments/hooks/use-deployment-row-actions";
import { useDeploymentsPage } from "@/features/deployments/hooks/use-deployments-page";
import { useActiveEnvironment } from "@/features/shell/use-active-environment";
import { Page, PageHeader } from "@/shared/components/page";
import { useNowTick } from "@/shared/lib/duration";
import { orpc, queryClient } from "@/shared/server/orpc";

export const Route = createFileRoute("/_app/$orgSlug/_shell/projects/$projectSlug/$envSlug/deployments")({
  staticData: { crumb: "Deployments" },
  validateSearch: zDeploymentsSearch,
  component: RouteComponent,
});

function RouteComponent() {
  const { project } = useLoaderData({ from: "/_app/$orgSlug/_shell/projects/$projectSlug" });
  const activeEnv = useActiveEnvironment(project.id);
  const { orgSlug, projectSlug, envSlug } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const rootNavigate = useNavigate();
  const page = useDeploymentsPage(project.id, activeEnv, search);
  const [rollbackTarget, setRollbackTarget] = useState<ProjectDeployment | null>(null);
  const actions = useDeploymentRowActions({
    projectId: project.id,
    orgSlug,
    projectSlug,
    envSlug,
    onRollback: setRollbackTarget,
  });
  // Re-render each minute so "Today", the clocks and relative times stay true.
  const now = useNowTick(true, 60_000);

  // Replace, not push: twisting a filter shouldn't fill the back stack.
  const patch = (next: Partial<DeploymentsSearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });
  const reset = () =>
    void navigate({ search: (prev) => ({ window: prev.window }), replace: true });

  return (
    <Page>
      <PageHeader
        title="Deployments"
        description={`Every deploy in ${page.envName}, and which one each resource is serving.`}
      />
      {isNeverDeployed(page.meta, search) ? null : (
        <DeploymentsFilters page={page} search={search} patch={patch} />
      )}
      <DeploymentsBody
        page={page}
        search={search}
        now={now}
        actions={actions}
        reset={reset}
        patch={patch}
        openGraph={() =>
          void rootNavigate({
            to: "/$orgSlug/projects/$projectSlug/$envSlug",
            params: { orgSlug, projectSlug, envSlug },
          })
        }
      />
      <RollbackDialog
        target={rollbackTarget}
        projectId={project.id}
        onClose={() => setRollbackTarget(null)}
        onRolledBack={() =>
          void queryClient.invalidateQueries({ queryKey: orpc.deployment.listByProject.key() })
        }
      />
    </Page>
  );
}
