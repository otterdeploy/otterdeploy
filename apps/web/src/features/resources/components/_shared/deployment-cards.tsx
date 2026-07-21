/**
 * Presentational cards/rows for the resource Deployments tab — the active-
 * deployment hero, the compact history rows + their action menu, and the status
 * badge. Split out of `resource-tasks-tab.tsx` to keep that file focused on the
 * live-query wiring and the hero/history split.
 */

import type { ProjectSlug } from "@otterdeploy/shared/id";
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
  status:
    | "pending"
    | "building"
    | "starting"
    | "running"
    | "crashed"
    | "failed"
    | "superseded"
    | "removed";
  errorMessage: string | null;
  taskCount: number;
  failedTaskCount: number;
  runningTaskCount: number;
  /** Observed restart-policy attempts (docker RestartCount / swarm failed
   *  tasks) and the configured cap. Null count = nothing restarted; null cap
   *  = unlimited. */
  restartCount: number | null;
  restartMaxAttempts: number | null;
  /** Commit author name + their GitHub avatar (git-push deploys only). */
  gitCommitAuthor: string | null;
  gitCommitAuthorAvatar: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
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
  projectSlug: ProjectSlug;
  projectId: string;
  resourceId: string;
  canRollback: boolean;
}) {
  const duration = useLiveDuration(deployment.createdAt, deployment.completedAt);
  // A failed/crashed history row must say WHY inline — the badge alone made
  // past failures opaque without a click-through to the detail page.
  const showError =
    deployment.errorMessage && (deployment.status === "failed" || deployment.status === "crashed");
  return (
    <div className="group px-3 py-2 text-left hover:bg-muted/20">
      <div className="grid grid-cols-[100px_1fr_140px_160px_32px] items-center gap-3">
        <Link
          to="/$orgSlug/$projectSlug/graph/$resourceId/deployment/$deploymentId"
          params={{
            orgSlug,
            projectSlug,
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
      {showError && (
        <p
          className="mt-1 truncate pl-[112px] font-mono text-[10.5px] text-destructive/80"
          title={deployment.errorMessage ?? undefined}
        >
          {deployment.errorMessage}
        </p>
      )}
    </div>
  );
}

// "superseded" is accurate but reads as jargon — a superseded deployment is
// simply an older one a newer deploy replaced. Show plainer words.
const STATUS_LABEL: Record<DeploymentInfo["status"], string> = {
  pending: "pending",
  building: "building",
  starting: "starting",
  running: "running",
  crashed: "crashed",
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
          // `crashed` shares the destructive palette with `failed` but pulses
          // (below) to read as an ACTIVE problem rather than a settled one.
          "border-destructive/30 bg-destructive/15 text-destructive":
            status === "failed" || status === "crashed",
          "border-warning/30 bg-warning/15 text-warning":
            status === "building" || status === "pending" || status === "starting",
        },
      )}
    >
      <span
        className={cn("size-2 rounded-full bg-muted-foreground/60", {
          "size-1.5": compact,
          "bg-success": status === "running",
          "bg-destructive": status === "failed" || status === "crashed",
          "bg-warning": status === "building" || status === "pending" || status === "starting",
          "animate-pulse": status === "running" || status === "crashed" || status === "starting",
        })}
      />
      {STATUS_LABEL[status]}
    </span>
  );
}
