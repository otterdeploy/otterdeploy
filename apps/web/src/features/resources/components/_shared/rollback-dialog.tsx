/**
 * Roll a service back to a past deployment: the confirm and the mutation, in
 * one place, for the two ways in: a history row's menu, and the failure card's
 * primary action (after a failed deploy, going back to the last good one was
 * only reachable through each history row's overflow menu).
 */
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { TypedConfirmDialog } from "@/shared/components/typed-confirm-dialog";
import { orpc } from "@/shared/server/orpc";

import type { DeploymentInfo } from "./deployment-cards";

/** A past deployment can be rolled back to when it's a settled successful
 *  deploy with a real built image (not a `pending:` placeholder). */
export function isRollbackable(d: DeploymentInfo): boolean {
  return (
    (d.status === "running" || d.status === "superseded") &&
    !!d.image &&
    !d.image.startsWith("pending:")
  );
}

/**
 * The deployment a failed latest deploy should offer to go back to: the most
 * recent one that can be rolled back to. `history` is newest first and
 * excludes the latest. Undefined when the latest did not fail or nothing
 * qualifies.
 */
export function lastGoodDeployment(
  latest: DeploymentInfo | null,
  history: readonly DeploymentInfo[],
): DeploymentInfo | undefined {
  if (!latest || (latest.status !== "failed" && latest.status !== "crashed")) return undefined;
  return history.find(isRollbackable);
}

/** How to name a deployment in one line: its commit, else its image tag. */
export function deploymentShortName(d: DeploymentInfo): string {
  if (d.gitSha) return d.gitSha.slice(0, 7);
  const tag = d.image.split("/").at(-1) ?? d.image;
  return tag;
}

export function RollbackDialog({
  deployment,
  projectId,
  resourceId,
  open,
  onOpenChange,
}: {
  deployment: DeploymentInfo;
  projectId: string;
  resourceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
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

  // Styled confirm (not typed): rollback is recoverable, roll forward again
  // from this same history.
  return (
    <TypedConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Roll back to this deployment?"
      description={
        <>
          Re-deploys <span className="font-mono text-foreground">{deployment.image}</span> with the
          service's current config, replacing what's running now. You can roll forward again from
          this same history.
        </>
      }
      confirmLabel="Roll back"
      pending={rollbackMut.isPending}
      pendingLabel="Rolling back…"
      onConfirm={() => {
        onOpenChange(false);
        rollbackMut.mutate({ projectId, resourceId, deploymentId: deployment.id });
      }}
    />
  );
}
