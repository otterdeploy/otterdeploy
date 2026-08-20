/**
 * One row of the project deployments table: Status (dot) / Resource / Type /
 * Env / What shipped / Trigger / Duration / Created / actions. Actions are
 * icon-only, verb in the tooltip: cancel (in-flight), roll back (eligible
 * history), and a ⋯ menu (open detail / view logs / copy sha). Split from
 * `deployments-table.tsx` to keep that file within budget.
 */

import { RotateLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { idSchema } from "@otterdeploy/shared/id";
import { useTranslation } from "react-i18next";

import { CancelDeploymentButton } from "@/features/deployments/components/cancel-deployment-button";
import { Button } from "@/shared/components/ui/button";
import { TableCell, TableRow } from "@/shared/components/ui/table";
import { formatDuration } from "@/shared/lib/duration";
import { shortImageRef } from "@/shared/lib/image-ref";
import { timeAgo } from "@/shared/lib/time";
import { cn } from "@/shared/lib/utils";

import { isRollbackEligible, type ProjectDeployment } from "../data/deployments-search";
import { DeploymentRowMenu } from "./deployment-row-menu";

/** Wall-clock ms since `iso`: impure by design (same idiom as `timeAgo`);
 *  it ticks via the parent's periodic refetch, not a per-row timer. */
function elapsedSinceMs(iso: string): number {
  return Date.now() - new Date(iso).getTime();
}

const IN_FLIGHT = new Set<ProjectDeployment["status"]>(["pending", "building", "starting"]);

/** Statuses under which the resource's latest row IS its current deployment
 *  (live, or live-but-unwell). A latest row that failed or was removed has
 *  nothing currently running to be "current" of. */
const CURRENT_STATUSES = new Set<ProjectDeployment["status"]>([
  "running",
  "starting",
  "crashed",
  "paused",
]);

/**
 * Status is the dot alone: the badge palette without the badge chrome. The
 * word lives in the tooltip and for screen readers. Warning states pulse,
 * same as the badge's dot does.
 */
function StatusDot({ status }: { status: ProjectDeployment["status"] }) {
  return (
    <span
      title={status === "superseded" ? "replaced" : status}
      className={cn("mt-1.5 inline-block size-2 rounded-full bg-muted-foreground/50", {
        "bg-success": status === "running",
        "bg-destructive": status === "failed" || status === "crashed",
        "animate-pulse bg-warning":
          status === "pending" || status === "building" || status === "starting",
      })}
    >
      <span className="sr-only">{status === "superseded" ? "replaced" : status}</span>
    </span>
  );
}

function ShippedCell({ d }: { d: ProjectDeployment }) {
  if (d.gitSha) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 font-mono text-[12px] text-foreground/80" title={d.gitSha}>
          {d.gitSha.slice(0, 7)}
        </span>
        <span
          className="truncate text-[12.5px] text-foreground/90"
          title={d.gitCommitMessage ?? undefined}
        >
          {d.gitCommitMessage ?? "–"}
        </span>
        {d.gitRef && (
          <span
            className="shrink-0 rounded-sm bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground"
            title={d.gitRef}
          >
            {d.gitRef}
          </span>
        )}
      </span>
    );
  }
  // Uploaded local source (CLI deploy), no commit, but the tarball's content
  // hash is the honest provenance.
  if (d.sourceSha) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 font-mono text-[12px] text-foreground/80" title={d.sourceSha}>
          {d.sourceSha.slice(0, 7)}
        </span>
        <span className="shrink-0 font-mono text-[10.5px] tracking-[0.12em] text-muted-foreground uppercase">
          source
        </span>
      </span>
    );
  }
  // Image-sourced (or database) deploy. The image ref is the provenance.
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate font-mono text-[12px] text-foreground/80" title={d.image}>
        {shortImageRef(d.image)}
      </span>
      <span className="shrink-0 font-mono text-[10.5px] tracking-[0.12em] text-muted-foreground uppercase">
        image
      </span>
    </span>
  );
}

/** Failed rows carry their reason inline; today a red dot with no words sends
 *  you clicking into the detail just to learn what broke. */
function ErrorLine({ d }: { d: ProjectDeployment }) {
  if (!d.errorMessage || (d.status !== "failed" && d.status !== "crashed")) return null;
  const text = d.errorMessage.length > 120 ? `${d.errorMessage.slice(0, 120)}…` : d.errorMessage;
  return (
    <span
      className="mt-1 block truncate font-mono text-[10.5px] text-destructive/90"
      title={d.errorMessage}
    >
      {text}
    </span>
  );
}

function DurationCell({ d }: { d: ProjectDeployment }) {
  if (d.completedAt) {
    const ms = new Date(d.completedAt).getTime() - new Date(d.createdAt).getTime();
    return <span className="tabular-nums">{formatDuration(ms)}</span>;
  }
  if (IN_FLIGHT.has(d.status)) {
    // Still in flight: show honest elapsed time, ticking via the parent's
    // periodic refetch (a per-second timer per row isn't worth the churn).
    return <span className="tabular-nums">{formatDuration(elapsedSinceMs(d.createdAt))}…</span>;
  }
  // Settled without a recorded completion (old rows): don't invent one.
  return <span className="text-muted-foreground/50">–</span>;
}

export function DeployRow({
  d,
  onOpen,
  onViewLogs,
  onRollback,
}: {
  d: ProjectDeployment;
  onOpen: (d: ProjectDeployment) => void;
  onViewLogs: (d: ProjectDeployment) => void;
  onRollback: (d: ProjectDeployment) => void;
}) {
  const { t } = useTranslation();
  const eligible = isRollbackEligible(d);
  const inFlight = d.status === "pending" || d.status === "building";
  return (
    <TableRow className="group cursor-pointer" onClick={() => onOpen(d)}>
      <TableCell className="pl-4">
        <StatusDot status={d.status} />
      </TableCell>
      <TableCell>
        <span className="block truncate font-mono text-[12px]" title={d.resourceName}>
          {d.resourceName}
        </span>
        {d.isLatest && CURRENT_STATUSES.has(d.status) && (
          <span className="mt-0.5 inline-block rounded-sm bg-success/15 px-1 font-mono text-[8.5px] tracking-[0.1em] text-success uppercase">
            {t("deployments.current")}
          </span>
        )}
      </TableCell>
      <TableCell className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">
        {d.resourceKind}
      </TableCell>
      <TableCell className="font-mono text-[11px] text-muted-foreground">
        <span className="block max-w-24 truncate" title={d.environmentName}>
          {d.environmentName}
        </span>
      </TableCell>
      <TableCell className="max-w-0">
        <ShippedCell d={d} />
        <ErrorLine d={d} />
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <span className="font-mono text-[11px]">{d.reason}</span>
        {d.gitCommitAuthor && (
          <span className="text-[12px] text-muted-foreground" title={d.gitCommitAuthor}>
            {" "}
            · {d.gitCommitAuthor}
          </span>
        )}
      </TableCell>
      <TableCell className="text-right font-mono text-[11px] text-muted-foreground">
        <DurationCell d={d} />
      </TableCell>
      <TableCell className="text-right text-[12px] whitespace-nowrap text-muted-foreground">
        <span title={new Date(d.createdAt).toLocaleString()}>{timeAgo(d.createdAt)}</span>
      </TableCell>
      {/* Actions are icons, never verbs: the tooltip + aria-label carry the
          words. stopPropagation everywhere so the row's open-detail click
          doesn't swallow them. */}
      <TableCell className="w-20 pr-4 text-right" onClick={(e) => e.stopPropagation()}>
        <span className="inline-flex items-center gap-1.5">
          {inFlight && (
            <CancelDeploymentButton
              // The client row type mirrors the wire shape with plain strings;
              // the button's prop is branded, so re-brand at this boundary the
              // same way route/form boundaries do.
              deploymentId={idSchema.deployment.parse(d.id)}
              status={d.status}
              compact
              className="size-7"
            />
          )}
          {eligible && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              // Recessed, never hidden (see the old rollback button's story):
              // resting at 70% keeps the row calm without hiding the control.
              className="size-7 opacity-70 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              title={t("deployments.rollBack")}
              aria-label={t("deployments.rollBack")}
              onClick={() => onRollback(d)}
            >
              <HugeiconsIcon icon={RotateLeft01Icon} strokeWidth={2} className="size-3.5" />
            </Button>
          )}
          <DeploymentRowMenu d={d} onOpen={onOpen} onViewLogs={onViewLogs} />
        </span>
      </TableCell>
    </TableRow>
  );
}
