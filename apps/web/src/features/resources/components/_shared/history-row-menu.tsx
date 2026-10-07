/**
 * Action menu for a history-row deployment: view-logs (always) plus an optional
 * one-click rollback (services only, settled successful deploy with a real
 * built image). Split out of `deployment-cards.tsx` for file size.
 */

import { useState } from "react";

import { MoreHorizontalCircle01Icon, PlayIcon, RotateLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { logSourceForStatus } from "@/features/resources/lib/deployment-log-tab";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";

import type { DeploymentInfo } from "./deployment-cards";
import type { PanelFocus } from "./panel-tab";

import { isRollbackable, RollbackDialog } from "./rollback-dialog";

export function HistoryRowMenu({
  deployment,
  projectId,
  resourceId,
  canRollback,
  focus,
}: {
  deployment: DeploymentInfo;
  projectId: string;
  resourceId: string;
  canRollback: boolean;
  /** "View logs" switches the panel to its Logs tab with this deployment's
   *  build or deploy log focused. */
  focus: PanelFocus;
}) {
  const deploymentId = deployment.id;
  // Controlled state because selecting the menu item closes the dropdown, so
  // the dialog must outlive it.
  const [confirmOpen, setConfirmOpen] = useState(false);

  const showRollback = canRollback && isRollbackable(deployment);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Deployment actions"
              // Recessed rather than hidden: same reason as the Roll back
              // button in features/deployments/components/deployment-row.tsx:
              // `opacity-0` has no reveal on a touch device, leaving the only
              // route to rollback invisible while still tappable.
              className="opacity-70 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100"
              onClick={(e) => e.stopPropagation()}
            />
          }
        >
          <HugeiconsIcon icon={MoreHorizontalCircle01Icon} strokeWidth={2} className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onClick={() =>
              focus.set({
                tab: "logs",
                deployment: deploymentId,
                logSource: logSourceForStatus(deployment.status),
              })
            }
          >
            <HugeiconsIcon icon={PlayIcon} strokeWidth={2} className="size-3.5" />
            View logs
          </DropdownMenuItem>
          {showRollback && (
            <DropdownMenuItem onClick={() => setConfirmOpen(true)}>
              <HugeiconsIcon icon={RotateLeft01Icon} strokeWidth={2} className="size-3.5" />
              Roll back to this
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {showRollback && (
        <RollbackDialog
          deployment={deployment}
          projectId={projectId}
          resourceId={resourceId}
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
        />
      )}
    </>
  );
}
