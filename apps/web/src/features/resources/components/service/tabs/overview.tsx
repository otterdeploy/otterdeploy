/**
 * Overview tab for a deployed service — the panel's landing surface.
 *
 * Four stat tiles (runtime state, replicas, last deploy, public reach), nav
 * cards that jump to the other panel tabs, and the three most recent
 * deployments (see {@link OverviewStatTiles} & friends in ./overview-parts).
 * Everything shown is real data the panel already loads: the live
 * `service.get` view, the resource row, and the shared deployments
 * collection — no invented numbers.
 */

import { and, eq, useLiveQuery } from "@tanstack/react-db";

import {
  DeploymentStatusBadge,
  type DeploymentInfo,
} from "@/features/resources/components/_shared/deployment-cards";
import { deploymentsCollection } from "@/features/resources/data/deployments";
import { shortImageRef } from "@/shared/lib/image-ref";

import { deriveServicePanelState, type ServiceRuntimeStatus } from "../service-status";
import { OverviewNavCards, OverviewStatTiles, relativeTime, useNowTick } from "./overview-parts";

export interface OverviewResource {
  resourceId: string;
  projectId: string;
  name: string;
  image: string;
  source: "image" | "git";
  replicas: number;
  publicEnabled: boolean;
  publicDomain: string | null;
  extraEnv: Record<string, string>;
  secretKeys: string[];
}

/** The slice of the live `service.get` view the overview reads. Undefined
 *  while loading — tiles show an honest "—" instead of a guess. */
export interface OverviewLiveService {
  pausedReplicas: number | null;
  runtime: { status: ServiceRuntimeStatus };
}

/** The three most recent deployments (click-through to the Deployments tab). */
function RecentDeployments({
  recent,
  now,
  onGoTab,
}: {
  recent: DeploymentInfo[];
  now: number;
  onGoTab: (tab: "deployments") => void;
}) {
  return (
    <div>
      <div className="text-[10.5px] font-medium tracking-[0.16em] text-muted-foreground/70 uppercase">
        Recent deployments
      </div>
      {recent.length === 0 ? (
        <p className="mt-2 rounded-md border border-dashed bg-muted/20 px-3 py-4 text-center text-[12px] text-muted-foreground">
          Nothing has been deployed yet — deployments will appear here.
        </p>
      ) : (
        <div className="mt-2 overflow-hidden rounded-md border bg-card">
          <div className="divide-y divide-border/40">
            {recent.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => onGoTab("deployments")}
                className="grid w-full grid-cols-[92px_1fr_auto] items-center gap-3 px-3 py-2 text-left hover:bg-muted/20"
              >
                <DeploymentStatusBadge status={d.status} compact />
                <span className="truncate font-mono text-[12px] text-foreground/80" title={d.image}>
                  {shortImageRef(d.image)}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {relativeTime(d.createdAt, now)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ServiceOverviewTab({
  resource,
  service,
  onGoTab,
}: {
  resource: OverviewResource;
  service: OverviewLiveService | undefined;
  onGoTab: (tab: "deployments" | "variables" | "settings") => void;
}) {
  const now = useNowTick();
  const { data: deployments } = useLiveQuery(
    (q) =>
      q
        .from({ d: deploymentsCollection })
        .where(({ d }) =>
          and(eq(d.projectId, resource.projectId), eq(d.resourceId, resource.resourceId)),
        )
        .orderBy(({ d }) => d.createdAt, "desc"),
    [resource.projectId, resource.resourceId],
  );

  const latest = (deployments.at(0) ?? null) as DeploymentInfo | null;
  const recent = deployments.slice(0, 3) as DeploymentInfo[];

  const state = deriveServicePanelState({
    pausedReplicas: service?.pausedReplicas ?? null,
    runtimeStatus: service?.runtime.status,
  });

  return (
    <div className="flex flex-col gap-5">
      <OverviewStatTiles
        resource={resource}
        service={service}
        state={state}
        latest={latest}
        now={now}
      />
      <OverviewNavCards
        resource={resource}
        deploymentsCount={deployments.length}
        latest={latest}
        onGoTab={onGoTab}
      />
      <RecentDeployments recent={recent} now={now} onGoTab={onGoTab} />
    </div>
  );
}
