/**
 * Presentational cards/rows for the resource Deployments tab — the active-
 * deployment hero, the compact history rows + their action menu, and the status
 * badge. Split out of `resource-tasks-tab.tsx` to keep that file focused on the
 * live-query wiring and the hero/history split.
 */

import { ContainerIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import { useLiveDuration } from "@/shared/lib/duration";
import { shortImageRef } from "@/shared/lib/image-ref";
import { cn } from "@/shared/lib/utils";

import { HistoryRowMenu } from "./history-row-menu";

export interface DeploymentInfo {
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

export function ActiveDeploymentCard({
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
  // Ticks while building/deploying (no completedAt), settles once terminal.
  const duration = useLiveDuration(deployment.createdAt, deployment.completedAt);

  return (
    <Link
      to="/$orgSlug/$projectSlug/graph/$resourceId/deployment/$deploymentId"
      params={{
        orgSlug,
        projectSlug: projectSlug as never,
        resourceId,
        deploymentId: deployment.id,
      }}
      search={{ tab: "details" }}
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
        {/* The count only earns its spot when it says something the status
            badge doesn't: real fan-out (>1) or a shortfall (0/1 running). */}
        {(replicas > 1 || runningCount !== replicas) && (
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <HugeiconsIcon icon={ContainerIcon} strokeWidth={2} className="size-3.5" />
              {runningCount}/{replicas} {replicas === 1 ? "instance" : "instances"}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {/* The full ref (namespace + 40-char sha tag) is a machine artifact —
            lead with the short form and keep the whole thing on hover. */}
        <span
          className="truncate font-mono text-[14px] font-semibold text-foreground"
          title={deployment.image}
        >
          {shortImageRef(deployment.image)}
        </span>
        <span className="text-[11.5px] text-muted-foreground">
          Deployed {new Date(deployment.createdAt).toLocaleString()}
          {duration && (
            <>
              {" · "}
              <span className="tabular-nums">
                {deployment.completedAt ? `took ${duration}` : `${duration} elapsed`}
              </span>
            </>
          )}
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

export function HistoryRow({
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
  const duration = useLiveDuration(deployment.createdAt, deployment.completedAt);
  return (
    <div className="group grid grid-cols-[100px_1fr_140px_160px_32px] items-center gap-3 px-3 py-2 text-left hover:bg-muted/20">
      <Link
        to="/$orgSlug/$projectSlug/graph/$resourceId/deployment/$deploymentId"
        params={{
          orgSlug,
          projectSlug: projectSlug as never,
          resourceId,
          deploymentId: deployment.id,
        }}
        search={{ tab: "details" }}
        className="contents"
      >
        <DeploymentStatusBadge status={deployment.status} compact />
        <span
          className="truncate font-mono text-[12px] text-foreground/80"
          title={deployment.image}
        >
          {shortImageRef(deployment.image)}
        </span>
        <span className="truncate font-mono text-[11px] text-muted-foreground tabular-nums">
          {deployment.reason} · {deployment.taskCount}{" "}
          {deployment.taskCount === 1 ? "task" : "tasks"}
          {duration && ` · ${duration}`}
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

// "superseded" is accurate but reads as jargon — a superseded deployment is
// simply an older one a newer deploy replaced. Show plainer words.
const STATUS_LABEL: Record<DeploymentInfo["status"], string> = {
  pending: "pending",
  building: "building",
  running: "running",
  failed: "failed",
  superseded: "replaced",
  removed: "removed",
};

export function DeploymentStatusBadge({
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
      {STATUS_LABEL[status]}
    </span>
  );
}
