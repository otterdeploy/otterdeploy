/**
 * Styled confirm for rolling a service back to a prior deployment. Reuses the
 * same `service.rollback` mutation as the per-resource history menu
 * (`features/resources/components/_shared/history-row-menu.tsx`) and the
 * shared TypedConfirmDialog safety pattern (plain-confirm strength — a
 * rollback is consequential but recoverable, so no type-the-phrase gate).
 */

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { TypedConfirmDialog } from "@/shared/components/typed-confirm-dialog";
import { shortImageRef } from "@/shared/lib/image-ref";
import { orpc } from "@/shared/server/orpc";

import type { ProjectDeployment } from "../data/deployments-search";

export function RollbackDialog({
  target,
  projectId,
  onClose,
  onRolledBack,
}: {
  /** The deployment to roll back to; null keeps the dialog closed. */
  target: ProjectDeployment | null;
  projectId: string;
  onClose: () => void;
  /** Called after the rollback is accepted — refetch the list here. */
  onRolledBack: () => void;
}) {
  // Re-points the service at this deployment's image and re-rolls; the list
  // picks up the new reason="rollback" row on its next refetch.
  const rollbackMut = useMutation({
    ...orpc.service.rollback.mutationOptions(),
    onSuccess: () => {
      toast.success("Rolling back", {
        description: target
          ? `Re-deploying ${shortImageRef(target.image)} on ${target.resourceName}.`
          : undefined,
      });
      onClose();
      onRolledBack();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to roll back"),
  });

  const provenance = target?.gitSha ? (
    <>
      commit <span className="font-mono text-foreground">{target.gitSha.slice(0, 7)}</span>
      {target.gitCommitMessage ? <> (“{target.gitCommitMessage}”)</> : null}
    </>
  ) : target?.sourceSha ? (
    <>
      source <span className="font-mono text-foreground">{target.sourceSha.slice(0, 7)}</span>
    </>
  ) : target ? (
    <span className="font-mono text-foreground">{shortImageRef(target.image)}</span>
  ) : null;

  return (
    <TypedConfirmDialog
      open={target != null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={
        <>
          Roll back{" "}
          {target?.resourceName ? (
            <span className="font-mono">{target.resourceName}</span>
          ) : (
            "this service"
          )}
          ?
        </>
      }
      description={
        <>
          Re-deploys {provenance} with the service's <em>current</em> configuration — environment
          and settings changed since then are kept, only the image goes back. You can roll forward
          again from this same history.
        </>
      }
      confirmLabel="Roll back"
      pendingLabel="Rolling back…"
      pending={rollbackMut.isPending}
      onConfirm={() => {
        if (!target) return;
        rollbackMut.mutate({
          projectId,
          resourceId: target.resourceId,
          deploymentId: target.id,
        });
      }}
    />
  );
}
