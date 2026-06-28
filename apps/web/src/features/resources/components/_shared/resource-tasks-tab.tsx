/**
 * Deployments tab body for a real resource. Top of the panel features the
 * currently-active deployment (the latest RUNNING row) as a hero card;
 * everything else falls under HISTORY below as compact rows. Railway-style.
 * Clicking either surface routes into the per-deployment detail page with
 * task progression + container logs. The cards/rows live in `deployment-cards`.
 */

import { ContainerIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";

import { deploymentsCollection } from "@/features/resources/data/deployments";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";

import { SectionLabel } from "./atoms";
import { ActiveDeploymentCard, HistoryRow } from "./deployment-cards";

interface ResourceTasksTabProps {
  projectId: string;
  resourceId: string;
  orgSlug: string;
  projectSlug: string;
  /** Services support one-click image rollback from a past deployment; other
   *  resource kinds (databases, compose) don't. Off by default. */
  canRollback?: boolean;
}

export function ResourceTasksTab({
  projectId,
  resourceId,
  orgSlug,
  projectSlug,
  canRollback = false,
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
      <div>
        <SectionLabel>Active deployment</SectionLabel>
        <p className="mt-1.5 text-[12px] text-muted-foreground">
          The deployment currently serving this resource. Click to see its tasks (containers) and
          tail their swarm progression + logs.
        </p>
        <div className="mt-3">
          {isLoading ? (
            <div className="rounded-lg border bg-card px-4 py-6 text-center text-[12px] text-muted-foreground">
              Loading deployments…
            </div>
          ) : active ? (
            <ActiveDeploymentCard
              deployment={active}
              orgSlug={orgSlug}
              projectSlug={projectSlug}
              resourceId={resourceId}
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
