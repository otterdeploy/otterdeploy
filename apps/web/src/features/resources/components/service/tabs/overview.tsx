/**
 * Overview tab for a deployed service. The panel's landing surface, and it is
 * CONTENT: the state and why, four facts, the latest deployment with its
 * phases inline, and the last lines the service wrote.
 *
 * It used to be four tiles plus three cards that linked to the other tabs —
 * navigation about navigation, on the one tab that should answer "what is
 * going on" by itself. Everything shown is real data the panel already loads:
 * the one service state, the resource row, and the shared deployments
 * collection. No invented numbers.
 */

import type { PanelFocus } from "@/features/resources/components/_shared/panel-tab";
import type { ResourceState } from "@/features/resources/lib/resource-state";

import {
  LatestDeploymentSection,
  LogTail,
  relativeTime,
  StateBanner,
  StatTile,
  useNowTick,
} from "@/features/resources/components/_shared/overview-atoms";
import { useResourceDeployments } from "@/features/resources/data/use-resource-deployments";
import { shortImageRef } from "@/shared/lib/image-ref";

import type { DeploymentInfo } from "../../_shared/deployment-cards";

export interface OverviewResource {
  resourceId: string;
  projectId: string;
  name: string;
  image: string;
  source: "image" | "git" | "upload";
  replicas: number;
  publicEnabled: boolean;
  publicDomain: string | null;
}

/** The slice of the live `service.get` view the overview reads. Undefined
 *  while loading: tiles show an honest "–" instead of a guess. */
export interface OverviewLiveService {
  pausedReplicas: number | null;
}

/** What the state asks you to do next. A failure wants its logs; a build
 *  wants to be watched; a healthy service asks nothing. */
function nextAction(
  state: ResourceState | null,
  onGoTab: (tab: "logs") => void,
): { label: string; onClick: () => void } | null {
  if (!state) return null;
  if (state.tone === "error") return { label: "See logs", onClick: () => onGoTab("logs") };
  if (state.tone === "building")
    return { label: "Watch the build", onClick: () => onGoTab("logs") };
  return null;
}

/** "main @ a1b2c3d · fix: cache headers" for a git service; the pinned image
 *  ref otherwise. */
function sourceTile(resource: OverviewResource, latest: DeploymentInfo | null) {
  if (resource.source === "git" && latest?.gitSha) {
    return {
      label: "Source",
      value: latest.gitSha.slice(0, 7),
      sub: latest.gitCommitMessage?.split("\n", 1)[0]?.trim() || "built from source",
      mono: true,
    };
  }
  return {
    label: resource.source === "git" ? "Source" : "Image",
    value: shortImageRef(resource.image),
    sub: resource.source === "git" ? "built from source" : "pinned image",
    mono: true,
  };
}

/** The four facts. Split out so the tab itself stays under the complexity cap. */
function OverviewTiles({
  resource,
  service,
  paused,
  latest,
  now,
}: {
  resource: OverviewResource;
  service: OverviewLiveService | undefined;
  paused: boolean;
  latest: DeploymentInfo | null;
  now: number;
}) {
  const desired = paused ? 0 : resource.replicas;
  const running = latest ? latest.runningTaskCount : null;
  const source = sourceTile(resource, latest);
  const exposed = resource.publicEnabled && !!resource.publicDomain;
  return (
    <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
      <StatTile
        label="Replicas"
        value={running != null ? `${running} / ${desired}` : `${desired} desired`}
        sub={
          paused && service?.pausedReplicas
            ? "resume restores replicas"
            : running != null
              ? "running / desired"
              : "no deployments yet"
        }
        mono
      />
      <StatTile
        label="Last deploy"
        value={latest ? relativeTime(latest.createdAt, now) : "never"}
        sub={latest ? `${latest.reason} · ${latest.status}` : "waiting on first deploy"}
      />
      <StatTile {...source} />
      <StatTile
        label="Public"
        value={exposed && resource.publicDomain ? resource.publicDomain : "internal only"}
        mono={exposed}
        sub={exposed ? "via the Caddy edge" : "project network only"}
      />
    </div>
  );
}

export function ServiceOverviewTab({
  resource,
  service,
  state,
  focus,
  onGoTab,
}: {
  resource: OverviewResource;
  service: OverviewLiveService | undefined;
  state: ResourceState | null;
  focus: PanelFocus;
  onGoTab: (tab: "deployments" | "logs") => void;
}) {
  const now = useNowTick();
  const { deployments } = useResourceDeployments(resource.projectId, resource.resourceId);
  const latest: DeploymentInfo | null = deployments.at(0) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <StateBanner state={state} action={nextAction(state, onGoTab)} />

      <OverviewTiles
        resource={resource}
        service={service}
        paused={state?.tone === "paused"}
        latest={latest}
        now={now}
      />

      <LatestDeploymentSection
        deployments={deployments}
        projectId={resource.projectId}
        resourceId={resource.resourceId}
        focus={focus}
        onSeeAll={() => onGoTab("deployments")}
        emptyLabel="Nothing has been deployed yet. Deployments will appear here."
      />

      <LogTail
        projectId={resource.projectId}
        resourceIds={[resource.resourceId]}
        onOpenLogs={() => onGoTab("logs")}
      />
    </div>
  );
}
