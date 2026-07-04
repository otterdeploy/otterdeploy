/**
 * Action menu for a history-row deployment: view-logs (always) plus an optional
 * one-click rollback (services only, settled successful deploy with a real
 * built image). Split out of `deployment-cards.tsx` for file size.
 */

import { MoreHorizontalCircle01Icon, PlayIcon, RotateLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { orpc } from "@/shared/server/orpc";

import type { DeploymentInfo } from "./deployment-cards";

/** A past deployment can be rolled back to when it's a settled successful
 *  deploy with a real built image (not a `pending:` placeholder). */
function isRollbackable(d: DeploymentInfo): boolean {
  return (
    (d.status === "running" || d.status === "superseded") &&
    !!d.image &&
    !d.image.startsWith("pending:")
  );
}

export function HistoryRowMenu({
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
              search: { tab: "details" },
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
