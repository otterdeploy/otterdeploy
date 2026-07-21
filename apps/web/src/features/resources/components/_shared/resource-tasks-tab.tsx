/**
 * Deployments tab body for a real resource. Top of the panel features the
 * currently-active deployment (the latest RUNNING row) as a hero card;
 * everything else falls under HISTORY below as compact rows. Railway-style.
 * Clicking either surface routes into the per-deployment detail page with
 * task progression + container logs. The cards/rows live in `deployment-cards`.
 */

import type { ProjectSlug } from "@otterdeploy/shared/id";
import type { ResourceNodeData } from "@/features/projects/components/graph/resource-node";
import { ContainerIcon, EarthIcon, Layers01Icon, ViewOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";

import { deploymentsCollection } from "@/features/resources/data/deployments";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";

import { SectionLabel } from "./atoms";
import { HistoryRow } from "./deployment-cards";
import { StagedDeploymentCard } from "./staged-deployment-card";

/** Exposure + scale summary shown above the active deployment (the mockup's
 *  "Service offline · 1 Replica" line). Optional — only services pass it. */
export interface DeploymentStatusHeader {
  publicEnabled: boolean;
  publicDomain: string | null;
  replicas: number;
  /** Whether the active deployment is currently serving (running). */
  running: boolean;
}

interface ResourceTasksTabProps {
  projectId: string;
  resourceId: string;
  orgSlug: string;
  projectSlug: ProjectSlug;
  /** Services support one-click image rollback from a past deployment; other
   *  resource kinds (databases, compose) don't. Off by default. */
  canRollback?: boolean;
  statusHeader?: DeploymentStatusHeader;
  /** Resource node data so the active card shows the real service/engine logo. */
  logoNode?: ResourceNodeData;
}

function ExposureRow({ header }: { header: DeploymentStatusHeader }) {
  const exposed = header.publicEnabled && header.publicDomain;
  const label = exposed
    ? header.running
      ? `Public on ${header.publicDomain}`
      : "Service offline"
    : "Unexposed service";
  return (
    <div className="flex items-center justify-between gap-3 text-[12.5px] text-muted-foreground">
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <HugeiconsIcon
          icon={exposed ? EarthIcon : ViewOffIcon}
          strokeWidth={2}
          className="size-3.5 shrink-0"
        />
        <span className="truncate">{label}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1.5">
        <HugeiconsIcon icon={Layers01Icon} strokeWidth={2} className="size-3.5" />
        {header.replicas} {header.replicas === 1 ? "Replica" : "Replicas"}
      </span>
    </div>
  );
}

export function ResourceTasksTab({
  projectId,
  resourceId,
  orgSlug,
  projectSlug,
  canRollback = false,
  statusHeader,
  logoNode,
}: ResourceTasksTabProps) {
  const { data: deployments, status } = useLiveQuery(
    (q) =>
      q
        .from({ d: deploymentsCollection })
        .where(({ d }) => and(eq(d.projectId, projectId), eq(d.resourceId, resourceId)))
        // Newest first. The collection isn't intrinsically ordered (it's a
        // keyed map), so without this the hero/history split below is
        // arbitrary and HISTORY rows render out of time order. createdAt is
        // an ISO-8601 string, so lexicographic desc == chronological desc.
        .orderBy(({ d }) => d.createdAt, "desc"),
    [projectId, resourceId],
  );
  const isLoading = status === "loading" && deployments.length === 0;

  // Active = the single most-recent deployment (the hero card). Everything
  // older is HISTORY. We intentionally pick the newest regardless of status:
  // a just-failed build is still "what happened last" and belongs in the hero
  // spot, not buried below a stale superseded row.
  const active = deployments.at(0) ?? null;
  const history = deployments.slice(1);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        {statusHeader && <ExposureRow header={statusHeader} />}
        <div>
          {isLoading ? (
            <div className="rounded-lg border bg-card px-4 py-6 text-center text-[12px] text-muted-foreground">
              Loading deployments…
            </div>
          ) : active ? (
            <StagedDeploymentCard
              deployment={active}
              logoNode={logoNode}
              orgSlug={orgSlug}
              projectSlug={projectSlug}
              projectId={projectId}
              resourceId={resourceId}
              canRollback={canRollback}
            />
          ) : (
            <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
              <EmptyHeader>
                <HugeiconsIcon
                  icon={ContainerIcon}
                  strokeWidth={1.5}
                  className="size-10 text-muted-foreground/50"
                />
                <EmptyTitle>No deployments yet</EmptyTitle>
                <EmptyDescription>
                  Once this resource is pushed to swarm, the active one will appear here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </div>

      {history.length > 0 && (
        <div>
          <SectionLabel>History</SectionLabel>
          <div className="mt-3 overflow-hidden rounded-md border bg-card">
            <div className="divide-y divide-border/40">
              {history.map((d) => (
                <HistoryRow
                  key={d.id}
                  deployment={d}
                  orgSlug={orgSlug}
                  projectSlug={projectSlug}
                  projectId={projectId}
                  resourceId={resourceId}
                  canRollback={canRollback}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
