/**
 * Overview tab for a database: the state and why, the facts that identify it
 * (engine, database name, where it lives, how it is reached), the latest
 * deployment with its phases, and its log tail. Same shape as the service and
 * stack overviews, so landing on any panel reads the same way.
 */

import { and, eq, useLiveQuery } from "@tanstack/react-db";

import type { PanelFocus } from "@/features/resources/components/_shared/panel-tab";
import type { ResourceState } from "@/features/resources/lib/resource-state";

import {
  LogTail,
  SectionHeading,
  StateBanner,
  StatTile,
} from "@/features/resources/components/_shared/overview-atoms";
import { StagedDeploymentCard } from "@/features/resources/components/_shared/staged-deployment-card";
import { deploymentsCollection } from "@/features/resources/data/deployments";

export function DatabaseOverviewTab({
  resource,
  state,
  focus,
  onGoTab,
}: {
  resource: {
    projectId: string;
    resourceId: string;
    engine: string;
    databaseName: string;
    hostName?: string | null;
    internalHostname: string;
  };
  state: ResourceState;
  focus: PanelFocus;
  onGoTab: (tab: "deployments" | "logs") => void;
}) {
  const { data: deployments } = useLiveQuery(
    (q) =>
      q
        .from({ d: deploymentsCollection })
        .where(({ d }) =>
          and(eq(d.projectId, resource.projectId), eq(d.resourceId, resource.resourceId)),
        )
        .orderBy(({ d }) => d.createdAt, "desc")
        .limit(2),
    [resource.projectId, resource.resourceId],
  );
  const latest = deployments.at(0) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <StateBanner
        state={state}
        action={
          state.tone === "error" ? { label: "See logs", onClick: () => onGoTab("logs") } : null
        }
      />

      <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        <StatTile label="Engine" value={resource.engine} sub="managed by otterdeploy" mono />
        <StatTile label="Database" value={resource.databaseName} mono />
        <StatTile
          label="Runs"
          value={resource.hostName ? `inside ${resource.hostName}` : "own container"}
          sub={resource.hostName ? "shared database server" : "dedicated"}
        />
        <StatTile
          label="Internal host"
          value={resource.internalHostname}
          sub="project network only"
          mono
        />
      </div>

      <div>
        <SectionHeading>Latest deployment</SectionHeading>
        {latest ? (
          <div className="mt-2">
            <StagedDeploymentCard
              deployment={latest}
              projectId={resource.projectId}
              resourceId={resource.resourceId}
              canRollback={false}
              focus={focus}
            />
            {deployments.length > 1 && (
              <button
                type="button"
                onClick={() => onGoTab("deployments")}
                className="mt-2 text-[11.5px] font-medium text-muted-foreground hover:text-foreground"
              >
                Earlier deployments →
              </button>
            )}
          </div>
        ) : (
          <p className="mt-2 rounded-md border border-dashed bg-muted/20 px-3 py-4 text-center text-[12px] text-muted-foreground">
            Nothing has been deployed yet.
          </p>
        )}
      </div>

      <LogTail
        projectId={resource.projectId}
        resourceIds={[resource.resourceId]}
        onOpenLogs={() => onGoTab("logs")}
      />
    </div>
  );
}
