/**
 * One deploy in the project list: Status · Change · Resource · By · Started ·
 * Took, then actions. Below 56rem of list width the header row goes and every
 * number carries its own label ("started", "took", "elapsed") instead.
 *
 * A failed deploy says why in the row itself, built from the app's own
 * pieces: the status icon and word, a plain sentence, the error line set like
 * a log line (level stripe, time, text), and the way to its log.
 */

import type { ReactNode } from "react";

import { deployStatusGroup } from "@otterdeploy/shared/deploy-status";
import { idSchema } from "@otterdeploy/shared/id";

import { useNowTick } from "@/shared/lib/duration";
import { cn } from "@/shared/lib/utils";

import type { ProjectDeployment, ServingDeployment } from "../data/deployments-search";

import { CancelDeploymentButton } from "./cancel-deployment-button";
import { FailureBlock } from "./deployment-failure";
import { ByCell, ChangeCell, StatusCell, TookCell } from "./deployment-row-cells";
import { DeploymentRowMenu, type RowActions } from "./deployment-row-menu";
import { Clock } from "./deployment-time";

/** Desktop columns, shared with the header row so they line up. */
export const ROW_COLUMNS =
  "@4xl:grid-cols-[150px_minmax(0,1fr)_112px_180px_96px_72px_64px] @4xl:gap-x-4";

export function DeploymentListRow({
  d,
  serving,
  now,
  expanded,
  onToggle,
  actions,
  detail,
}: {
  d: ProjectDeployment;
  /** What this row's resource is serving, for "kept serving …". */
  serving: ServingDeployment | undefined;
  now: number;
  expanded: boolean;
  onToggle: () => void;
  actions: RowActions;
  detail: ReactNode;
}) {
  const inFlight = deployStatusGroup(d.status) === "in-progress";
  const tick = useNowTick(inFlight);
  const clock = inFlight ? tick : now;
  const detailId = `deployment-detail-${d.id}`;
  return (
    <li className="border-t border-border/70 first:border-t-0">
      <div
        // The row is a large click target for the mouse; the keyboard and
        // screen readers use the Change title, which is a real button.
        onClick={(e) => {
          if (e.target instanceof Element && e.target.closest("button, a, [role=menuitem]")) return;
          onToggle();
        }}
        className={cn(
          "grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3.5 py-3 transition-colors hover:bg-muted/50 @4xl:px-4 @4xl:py-2.5",
          ROW_COLUMNS,
          expanded && "bg-muted/50",
        )}
      >
        <div className="col-start-1 row-start-1 @4xl:col-start-1">
          <StatusCell d={d} now={clock} />
        </div>
        <div className="col-start-2 row-start-1 self-start text-right @4xl:col-start-5 @4xl:self-center">
          <span className="text-[11.5px] text-muted-foreground @4xl:hidden">started </span>
          <Clock iso={d.createdAt} now={clock} />
        </div>
        <div className="col-span-2 row-start-2 @4xl:col-span-1 @4xl:col-start-2 @4xl:row-start-1">
          <ChangeCell d={d} expanded={expanded} detailId={detailId} onToggle={onToggle} />
        </div>
        <div className="col-start-1 row-start-3 min-w-0 truncate font-mono text-[12.5px] @4xl:col-start-3 @4xl:row-start-1">
          {d.resourceName}
        </div>
        <div className="col-start-2 row-start-3 @4xl:col-start-6 @4xl:row-start-1">
          <TookCell d={d} now={clock} />
        </div>
        <div className="col-start-1 row-start-4 mt-1 @4xl:col-start-4 @4xl:row-start-1 @4xl:mt-0">
          <ByCell d={d} />
        </div>
        <div className="col-start-2 row-start-4 flex items-center justify-end gap-1 @4xl:col-start-7 @4xl:row-start-1">
          {d.status === "pending" || d.status === "building" ? (
            <CancelDeploymentButton
              deploymentId={idSchema.deployment.parse(d.id)}
              status={d.status}
              compact
              className="size-7"
            />
          ) : null}
          <DeploymentRowMenu d={d} actions={actions} />
        </div>
        {deployStatusGroup(d.status) === "failed" || d.status === "cancelled" ? (
          <div className="col-span-2 row-start-5 mt-1 min-w-0 @4xl:col-start-2 @4xl:col-end-7 @4xl:row-start-2">
            <FailureBlock d={d} serving={serving} onViewLogs={() => actions.onViewLogs(d)} />
          </div>
        ) : null}
      </div>
      {expanded ? (
        <div id={detailId} className="bg-muted/25">
          {detail}
        </div>
      ) : null}
    </li>
  );
}
