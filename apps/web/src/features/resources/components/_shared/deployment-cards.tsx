/**
 * Presentational rows for the resource Deployments tab: the history rows (each
 * expands IN PLACE to its phase timeline: no third overlay over the panel),
 * their action menu, and the status dot. Split out of `resource-tasks-tab.tsx`
 * to keep that file focused on the live-query wiring and the hero/history
 * split.
 */

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { logSourceForStatus } from "@/features/resources/lib/deployment-log-tab";
import { useLiveDuration } from "@/shared/lib/duration";
import { shortImageRef } from "@/shared/lib/image-ref";
import { cn } from "@/shared/lib/utils";

import type { PanelFocus } from "./panel-tab";

import { DeploymentTimelineView } from "./deployment-timeline-view";
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
    | "paused"
    | "failed"
    | "cancelled"
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
  /** Commit provenance: the change this deployment put into service. Present
   *  for anything built from a repo (push, UI deploy, initial deploy) and
   *  inherited by a rollback; null for image/database deploys. */
  gitSha: string | null;
  gitCommitMessage: string | null;
  gitCommitAuthor: string | null;
  gitCommitAuthorAvatar: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function HistoryRow({
  deployment,
  projectId,
  resourceId,
  canRollback,
  focus,
  expanded,
  onToggle,
}: {
  deployment: DeploymentInfo;
  projectId: string;
  resourceId: string;
  canRollback: boolean;
  focus: PanelFocus;
  /** Open in place: the phase timeline under the row. The URL's
   *  `?deployment=` marks it, so a link to a failed deploy lands expanded. */
  expanded: boolean;
  onToggle: () => void;
}) {
  const duration = useLiveDuration(deployment.createdAt, deployment.completedAt);
  // A failed/crashed history row must say WHY inline. The dot alone made
  // past failures opaque without opening the row.
  const showError =
    !expanded &&
    deployment.errorMessage &&
    (deployment.status === "failed" || deployment.status === "crashed");
  const openLogs = (source: "build" | "deploy") =>
    focus.set({ tab: "logs", deployment: deployment.id, logSource: source });
  return (
    <div className={cn("group text-left", expanded && "bg-muted/10")}>
      <div className="grid grid-cols-[20px_1fr_140px_160px_auto_32px] items-center gap-3 px-3 py-2 hover:bg-muted/20">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="contents"
          title={deployment.status}
        >
          <DeploymentStatusBadge status={deployment.status} />
          <HistoryTitle deployment={deployment} />
          <span className="truncate font-mono text-[11px] text-muted-foreground tabular-nums">
            {deployment.reason} · {deployment.taskCount}{" "}
            {deployment.taskCount === 1 ? "task" : "tasks"}
            {duration && ` · ${duration}`}
          </span>
          <span className="text-right font-mono text-[11px] text-muted-foreground">
            {new Date(deployment.createdAt).toLocaleString()}
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            strokeWidth={2}
            className={cn(
              "size-3.5 text-muted-foreground/60 transition-transform",
              !expanded && "-rotate-90",
            )}
          />
        </button>
        <HistoryRowMenu
          deployment={deployment}
          projectId={projectId}
          resourceId={resourceId}
          canRollback={canRollback}
          focus={focus}
        />
      </div>
      {showError && (
        <p
          className="truncate px-3 pb-2 pl-[44px] font-mono text-[10.5px] text-destructive/80"
          title={deployment.errorMessage ?? undefined}
        >
          {deployment.errorMessage}
        </p>
      )}
      {expanded && <HistoryRowDetails deployment={deployment} onOpenLogs={openLogs} />}
    </div>
  );
}

/** What the row is: the commit (sha + subject) for a build from a repo, the
 *  image ref otherwise. */
function HistoryTitle({ deployment }: { deployment: DeploymentInfo }) {
  const subject = deployment.gitCommitMessage?.split("\n", 1)[0]?.trim();
  return (
    <span
      className="truncate font-mono text-[12px] text-foreground/80"
      title={deployment.gitCommitMessage ?? deployment.image}
    >
      {deployment.gitSha ? (
        <>
          <span className="text-foreground/60">{deployment.gitSha.slice(0, 7)}</span>{" "}
          {subject || shortImageRef(deployment.image)}
        </>
      ) : (
        shortImageRef(deployment.image)
      )}
    </span>
  );
}

/** The expanded row: the phase timeline and the way to its logs. */
function HistoryRowDetails({
  deployment,
  onOpenLogs,
}: {
  deployment: DeploymentInfo;
  onOpenLogs: (source: "build" | "deploy") => void;
}) {
  return (
    <div className="border-t border-border/60">
      <DeploymentTimelineView deployment={deployment} onOpenLogs={onOpenLogs} />
      <div className="flex justify-end gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => onOpenLogs(logSourceForStatus(deployment.status))}
          className="rounded-md border border-border/60 px-2.5 py-1 text-[12px] text-foreground/80 transition-colors hover:bg-muted/50"
        >
          View logs
        </button>
      </div>
    </div>
  );
}

// "superseded" is accurate but reads as jargon. A superseded deployment is
// simply an older one a newer deploy replaced. Show plainer words.
const STATUS_LABEL: Record<DeploymentInfo["status"], string> = {
  pending: "pending",
  building: "building",
  starting: "starting",
  running: "running",
  crashed: "crashed",
  // Deliberately stopped (scaled to zero). Rendered calm grey, no pulse, so it
  // never reads as the green live "running" it replaces.
  paused: "paused",
  failed: "failed",
  // Grey like `replaced`, never the destructive palette: a build someone
  // stopped on purpose is not an incident, and colouring it red would send
  // people digging through logs for a fault that was never there.
  cancelled: "cancelled",
  superseded: "replaced",
  removed: "removed",
};

/**
 * A deployment's status as a dot in the app's one vocabulary. The word lives
 * in the tooltip and for screen readers; the uppercase chip it replaces was the
 * loudest thing on every row for the least useful fact on it (owner call,
 * 2026-08-29: "the dots is enough").
 */
export function DeploymentStatusBadge({ status }: { status: DeploymentInfo["status"] }) {
  return (
    <span
      role="img"
      aria-label={STATUS_LABEL[status]}
      title={STATUS_LABEL[status]}
      className="grid size-4 shrink-0 place-items-center"
    >
      <span
        className={cn("size-2 rounded-full bg-muted-foreground/50", {
          "bg-success": status === "running",
          "bg-destructive": status === "failed" || status === "crashed",
          "bg-warning": status === "building" || status === "pending" || status === "starting",
          "animate-pulse": status === "crashed" || status === "starting" || status === "building",
        })}
      />
    </span>
  );
}

/** The word for a status, for the places that need one next to the dot. */
export const deploymentStatusLabel = (status: DeploymentInfo["status"]): string =>
  STATUS_LABEL[status];
