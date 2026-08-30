/**
 * Overview tab for a database: the state and why, the facts that identify it
 * (engine, database name, where it lives, how it is reached), the latest
 * deployment with its phases, and its log tail. Same shape as the service and
 * stack overviews, so landing on any panel reads the same way.
 */

import type { PanelFocus } from "@/features/resources/components/_shared/panel-tab";
import type { ResourceState } from "@/features/resources/lib/resource-state";

import {
  LatestDeploymentSection,
  LogTail,
  StateBanner,
  StatTile,
} from "@/features/resources/components/_shared/overview-atoms";
import { useResourceDeployments } from "@/features/resources/data/use-resource-deployments";

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
  const { deployments } = useResourceDeployments(resource.projectId, resource.resourceId, 2);

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

      <LatestDeploymentSection
        deployments={deployments}
        projectId={resource.projectId}
        resourceId={resource.resourceId}
        focus={focus}
        onSeeAll={() => onGoTab("deployments")}
      />

      <LogTail
        projectId={resource.projectId}
        resourceIds={[resource.resourceId]}
        onOpenLogs={() => onGoTab("logs")}
      />
    </div>
  );
}
