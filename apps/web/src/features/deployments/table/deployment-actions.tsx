/**
 * What you can DO from the deployments feed.
 *
 * These are the first row actions in this migration that change a RUNNING
 * system rather than a list: cancel kills a build container, rollback re-rolls
 * a service onto an older image. Both confirm (see `deployment-confirms.tsx`),
 * and both are offered only when they would actually do something — the shell
 * renders an actions cell for every row, and a Cancel that no-ops on a finished
 * build is worse than an empty cell, because it reports success for doing
 * nothing.
 *
 * Cancel and rollback are mutually exclusive by definition: cancel needs a row
 * still in flight, rollback needs one that has settled successfully. So the
 * cell holds at most two controls — one of those plus the ⋯ menu — and fits the
 * shell's 92px actions column without widening it.
 *
 * Callbacks rather than mutations, like the other migrated surfaces: the route
 * owns `orpc.deployment.cancel` and `orpc.service.rollback`, and keeping the
 * cells free of data access is what lets the preview render the real controls.
 */

import { MoreHorizontalCircle01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { formatNumber } from "@otterdeploy/shared/format";
import { useTranslation } from "react-i18next";

import type { ProjectDeployment } from "@/features/deployments/data/deployments-search";
import type { DeploymentRow } from "@/features/deployments/table/deployment-cells";

import { isRollbackEligible } from "@/features/deployments/data/deployments-search";
import {
  CancelAction,
  isCancellable,
  RollbackAction,
} from "@/features/deployments/table/deployment-confirms";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { formatDuration } from "@/shared/lib/duration";

export interface DeploymentActions {
  /** Kill the build container. Only ever called for a `pending`/`building` row. */
  onCancel: (row: DeploymentRow) => Promise<void>;
  /** Re-roll the service onto this row's image. */
  onRollback: (row: DeploymentRow) => Promise<void>;
  onViewLogs: (row: DeploymentRow) => void;
  onCopyRef: (row: DeploymentRow) => void;
  /** False when the caller lacks deploy rights — the controls say so. */
  canDeploy?: boolean;
}

/** The row's copyable provenance, in preference order. Every deploy has an image. */
export function provenanceRef(row: ProjectDeployment): string {
  return row.gitSha ?? row.sourceSha ?? row.image;
}

export function DeploymentRowActions({
  row,
  onCancel,
  onRollback,
  onViewLogs,
  onCopyRef,
  canDeploy = true,
}: { row: DeploymentRow } & DeploymentActions) {
  return (
    <span className="flex items-center gap-1">
      {canDeploy && isCancellable(row.status) ? (
        <CancelAction row={row} onCancel={onCancel} />
      ) : null}
      {canDeploy && isRollbackEligible(row) ? (
        <RollbackAction row={row} onRollback={onRollback} />
      ) : null}
      <RowMenu row={row} onViewLogs={onViewLogs} onCopyRef={onCopyRef} />
    </span>
  );
}

/**
 * The non-destructive rest.
 *
 * "Open detail" is gone from the old menu on purpose: on the shell, clicking
 * the row IS opening the detail, and a menu item duplicating the row's own
 * click target is a leftover from a table that had no sheet.
 */
function RowMenu({
  row,
  onViewLogs,
  onCopyRef,
}: {
  row: DeploymentRow;
  onViewLogs: (row: DeploymentRow) => void;
  onCopyRef: (row: DeploymentRow) => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            title={t("deployments.moreActions")}
            aria-label={t("deployments.moreActions")}
          >
            <HugeiconsIcon icon={MoreHorizontalCircle01Icon} strokeWidth={2} className="size-3.5" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onViewLogs(row)}>
          {t("deployments.viewLogs")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onCopyRef(row)}>
          {t("deployments.copySha")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The toolbar's honest numbers.
 *
 * The old page carried a four-card stat strip above the table. Two of its four
 * figures — the window total and the shape of the failures — are now the
 * histogram, drawn over the same window and readable at a glance, so repeating
 * them as numerals would be the same fact twice. The two the histogram cannot
 * say are how long a deploy takes and how many are running RIGHT NOW, and those
 * come across as text.
 *
 * Rendered from what the feed already reports, so it narrows with the filters
 * rather than describing a window the table is no longer showing.
 */
export function DeploymentSummary({
  inFlight,
  medianDurationMs,
}: {
  inFlight: number;
  /** Median wall time of completed deploys in the window. Null = none completed. */
  medianDurationMs: number | null;
}) {
  return (
    <span className="flex shrink-0 items-center gap-3 text-[11px] whitespace-nowrap text-muted-foreground">
      {inFlight > 0 ? (
        <span className="flex items-center gap-1.5 text-foreground">
          <span aria-hidden className="size-1.5 rounded-full bg-info motion-safe:animate-pulse" />
          {formatNumber(inFlight)} in flight
        </span>
      ) : null}
      {medianDurationMs === null ? null : (
        <span title="Median wall time of completed deploys in this window.">
          median <span className="font-mono tabular-nums">{formatDuration(medianDurationMs)}</span>
        </span>
      )}
    </span>
  );
}
