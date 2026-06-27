/**
 * Deployments tab body for a real resource. Top of the panel features the
 * currently-active deployment (the latest RUNNING row) as a hero card;
 * everything else falls under HISTORY below as compact rows. Railway-style.
 * Clicking either surface routes into the per-deployment detail page with
 * task progression + container logs.
 */

import {
  ContainerIcon,
  MoreHorizontalCircle01Icon,
  PlayIcon,
  RotateLeft01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { deploymentsCollection } from "@/features/resources/data/deployments";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { SectionLabel } from "./atoms";

interface DeploymentInfo {
  id: string;
  resourceId: string;
  image: string;
  reason:
    | "create"
    | "redeploy"
    | "env-change"
    | "image-change"
    | "restart"
    | "git-push"
    | "rollback";
  status: "pending" | "building" | "running" | "failed" | "superseded" | "removed";
  errorMessage: string | null;
  taskCount: number;
  failedTaskCount: number;
  runningTaskCount: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

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

function ActiveDeploymentCard({
  deployment,
  orgSlug,
  projectSlug,
  resourceId,
}: {
  deployment: DeploymentInfo;
  orgSlug: string;
  projectSlug: string;
  resourceId: string;
}) {
  // Database resources are always single-replica (see swarm/database.ts
  // `Replicated: { Replicas: 1 }`). When this panel grows service support
  // it should read the actual replica count off the resource.
  const replicas = 1;
  const runningCount = deployment.runningTaskCount;

  return (
    <Link
      to="/$orgSlug/$projectSlug/graph/$resourceId/deployment/$deploymentId"
      params={{
        orgSlug,
        projectSlug: projectSlug as never,
        resourceId,
        deploymentId: deployment.id,
      }}
      className={cn(
        "group flex flex-col gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/30",
        deployment.status === "running"
          ? "border-success/30"
          : deployment.status === "failed"
            ? "border-destructive/30"
            : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <DeploymentStatusBadge status={deployment.status} />
          <span className="font-mono text-[10.5px] tracking-[0.16em] text-muted-foreground uppercase">
            {deployment.reason}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <HugeiconsIcon icon={ContainerIcon} strokeWidth={2} className="size-3.5" />
            {runningCount}/{replicas} {replicas === 1 ? "replica" : "replicas"}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="truncate font-mono text-[14px] font-semibold text-foreground">
          {deployment.image}
        </span>
        <span className="text-[11.5px] text-muted-foreground">
          Deployed {new Date(deployment.createdAt).toLocaleString()}
        </span>
      </div>

      {deployment.errorMessage && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 font-mono text-[11px] text-destructive">
          {deployment.errorMessage}
        </p>
      )}
    </Link>
  );
}

function HistoryRow({
  deployment,
  orgSlug,
  projectSlug,
  projectId,
  resourceId,
  canRollback,
}: {
  deployment: DeploymentInfo;
  orgSlug: string;
  projectSlug: string;
  projectId: string;
  resourceId: string;
  canRollback: boolean;
}) {
  return (
    <div className="group grid grid-cols-[100px_1fr_120px_160px_32px] items-center gap-3 px-3 py-2 text-left hover:bg-muted/20">
      <Link
        to="/$orgSlug/$projectSlug/graph/$resourceId/deployment/$deploymentId"
        params={{
          orgSlug,
          projectSlug: projectSlug as never,
          resourceId,
          deploymentId: deployment.id,
        }}
        className="contents"
      >
        <DeploymentStatusBadge status={deployment.status} compact />
        <span className="truncate font-mono text-[12px] text-foreground/80">
          {deployment.image}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {deployment.reason} · {deployment.taskCount}{" "}
          {deployment.taskCount === 1 ? "task" : "tasks"}
        </span>
        <span className="text-right font-mono text-[11px] text-muted-foreground">
          {new Date(deployment.createdAt).toLocaleString()}
        </span>
      </Link>
      <HistoryRowMenu
        deployment={deployment}
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        projectId={projectId}
        resourceId={resourceId}
        canRollback={canRollback}
      />
    </div>
  );
}

/** A past deployment can be rolled back to when it's a settled successful
 *  deploy with a real built image (not a `pending:` placeholder). */
function isRollbackable(d: DeploymentInfo): boolean {
  return (
    (d.status === "running" || d.status === "superseded") &&
    !!d.image &&
    !d.image.startsWith("pending:")
  );
}

function HistoryRowMenu({
  deployment,
  orgSlug,
  projectSlug,
  projectId,
  resourceId,
  canRollback,
}: {
  deployment: DeploymentInfo;
  orgSlug: string;
  projectSlug: string;
  projectId: string;
  resourceId: string;
  canRollback: boolean;
}) {
  const navigate = useNavigate();
  const deploymentId = deployment.id;

  // Re-points the service at this deployment's image and re-rolls. The live
  // deployments collection picks up the new rollback row on its next sync.
  const rollbackMut = useMutation({
    ...orpc.service.rollback.mutationOptions(),
    onSuccess: () =>
      toast.success("Rolling back", {
        description: `Re-deploying ${deployment.image}. Track it above.`,
      }),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to roll back"),
  });

  const showRollback = canRollback && isRollbackable(deployment);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Deployment actions"
            className="opacity-0 group-hover:opacity-100 data-[popup-open]:opacity-100"
            onClick={(e) => e.stopPropagation()}
          />
        }
      >
        <HugeiconsIcon icon={MoreHorizontalCircle01Icon} strokeWidth={2} className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          onSelect={() =>
            navigate({
              to: "/$orgSlug/$projectSlug/graph/$resourceId/deployment/$deploymentId",
              params: {
                orgSlug,
                projectSlug: projectSlug as never,
                resourceId,
                deploymentId,
              },
            })
          }
        >
          <HugeiconsIcon icon={PlayIcon} strokeWidth={2} className="size-3.5" />
          View logs
        </DropdownMenuItem>
        {showRollback && (
          <DropdownMenuItem
            disabled={rollbackMut.isPending}
            onSelect={() => {
              if (
                !window.confirm(
                  `Roll back to ${deployment.image}? This re-deploys the old image with the service's current config.`,
                )
              ) {
                return;
              }
              rollbackMut.mutate({ projectId, resourceId, deploymentId });
            }}
          >
            <HugeiconsIcon icon={RotateLeft01Icon} strokeWidth={2} className="size-3.5" />
            {rollbackMut.isPending ? "Rolling back…" : "Roll back to this"}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DeploymentStatusBadge({
  status,
  compact = false,
}: {
  status: DeploymentInfo["status"];
  compact?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border border-border/60 bg-muted px-2.5 py-1 font-mono text-[11px] font-medium text-muted-foreground uppercase",
        {
          "px-2 py-0.5 text-[10px]": compact,
          "border-success/30 bg-success/15 text-success": status === "running",
          "border-destructive/30 bg-destructive/15 text-destructive": status === "failed",
          "border-warning/30 bg-warning/15 text-warning":
            status === "building" || status === "pending",
        },
      )}
    >
      <span
        className={cn("size-2 rounded-full bg-muted-foreground/60", {
          "size-1.5": compact,
          "bg-success": status === "running",
          "bg-destructive": status === "failed",
          "bg-warning": status === "building" || status === "pending",
          "animate-pulse": status === "running",
        })}
      />
      {status}
    </span>
  );
}
