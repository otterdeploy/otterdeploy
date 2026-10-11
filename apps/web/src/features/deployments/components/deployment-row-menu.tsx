/**
 * The ⋯ menu on a project-deployments row, and the actions it shares with the
 * expanded row's buttons: redeploy (or retry a failed one), roll back to this,
 * view logs, copy the SHA. Each is offered only when it would do something:
 * a Roll back on the deploy already serving would report success for nothing.
 */

import {
  Copy01Icon,
  File01Icon,
  MoreHorizontalCircle01Icon,
  RefreshIcon,
  RotateLeft01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";

import { isRollbackEligible, type ProjectDeployment } from "../data/deployments-search";
import { canRedeploy, copyLabel } from "../model/deployment-actions";

export interface RowActions {
  onRedeploy: (d: ProjectDeployment) => void;
  onRollback: (d: ProjectDeployment) => void;
  onViewLogs: (d: ProjectDeployment) => void;
  onCopy: (d: ProjectDeployment) => void;
}

export function DeploymentRowMenu({ d, actions }: { d: ProjectDeployment; actions: RowActions }) {
  const redeploy = canRedeploy(d);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label="Deployment actions"
          >
            <HugeiconsIcon icon={MoreHorizontalCircle01Icon} strokeWidth={2} className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-48">
        {redeploy ? (
          <DropdownMenuItem onClick={() => actions.onRedeploy(d)}>
            <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
            {redeploy}
          </DropdownMenuItem>
        ) : null}
        {isRollbackEligible(d) ? (
          <DropdownMenuItem onClick={() => actions.onRollback(d)}>
            <HugeiconsIcon icon={RotateLeft01Icon} strokeWidth={2} />
            Roll back to this
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={() => actions.onViewLogs(d)}>
          <HugeiconsIcon icon={File01Icon} strokeWidth={2} />
          View logs
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => actions.onCopy(d)}>
          <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} />
          {copyLabel(d)}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
