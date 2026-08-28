/**
 * The confirm dialog behind the graph context menu's "Delete", so a
 * right-click can finish the job in place instead of dropping the operator on
 * a Settings tab to hunt for the danger zone.
 *
 * It implements NO new delete logic. Each kind runs exactly the path its own
 * resource panel's danger zone runs:
 *   - service  → stage the removal from `manifest.services`
 *                (features/resources/components/service/tabs/settings/danger-zone)
 *   - database → stage the removal from `manifest.databases`
 *                (features/resources/components/postgres/tabs/settings/danger-zone)
 *     Both go through `useStageManifestChange`, so teardown happens on the next
 *     Deploy like every other pending change, which is why the copy says
 *     "staged", not "destroyed".
 *   - compose  → `orpc.compose.delete`, which IS immediate, with the same
 *                `Deleted <name>` toast the compose panel shows. The dialog
 *                does not wait for it: the node is marked `deleting` and the
 *                dialog closes (see deleting-store).
 *
 * Rendered by GraphCanvas as a SIBLING of the menu, not inside it: the
 * DropdownMenu unmounts the instant Delete is clicked, and a dialog nested in
 * it would unmount with it. Same always-mounted, `target`-driven shape as
 * features/deployments/components/rollback-dialog.tsx.
 */

import { useMutation } from "@tanstack/react-query";
import { useMatch, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import type { Id, ID_PREFIX } from "@otterdeploy/shared/id";

import {
  invalidateManifestConsumers,
  useStageManifestChange,
} from "@/features/projects/hooks/use-manifest-stage";
import {
  clearDeleting,
  markDeleting,
} from "@/features/projects/components/graph/deleting-store";
import type {
  ResourceFlowNode,
  ResourceKind,
} from "@/features/projects/components/graph/resource-node-types";
import { TypedConfirmDialog } from "@/shared/components/typed-confirm-dialog";
import { toastMessage } from "@/shared/lib/errors";
import { orpc } from "@/shared/server/orpc";

type ProjectId = Id<typeof ID_PREFIX.project>;

interface DeleteCopy {
  description: string;
  pendingLabel: string;
}

/** Per-kind consequence copy. Only the three kinds the menu offers Delete for
 *  appear here, anything else leaves the dialog closed. Staged kinds must not
 *  claim the resource is gone: nothing is torn down until the next Deploy. */
const DELETE_COPY: Partial<Record<ResourceKind, DeleteCopy>> = {
  service: {
    description:
      "This stages the deletion of the service, its proxy routes, and its stored env vars. Nothing is torn down until you Deploy.",
    pendingLabel: "Staging…",
  },
  database: {
    description:
      "This stages the deletion of the database, its volume, and its proxy route. Nothing is torn down until you Deploy, and once it is, the data is unrecoverable.",
    pendingLabel: "Staging…",
  },
  compose: {
    description:
      "This deletes the stack and tears down every service in it immediately. It can't be undone.",
    pendingLabel: "Deleting…",
  },
};

export function GraphNodeDeleteDialog({
  target,
  projectId,
  onClose,
}: {
  /** The node to delete; null keeps the dialog closed. */
  target: ResourceFlowNode | null;
  projectId: ProjectId;
  /** Clear the pending-delete target. Cancel, or a finished delete. */
  onClose: () => void;
}) {
  const navigate = useNavigate();
  // The open detail panel, if any. A delete that kills the resource the panel
  // is showing must not leave the operator parked on a dead route. The danger
  // zones navigate away via their panel's onClose, so do the same here.
  const panelMatch = useMatch({
    from: "/_app/$orgSlug/_shell/$projectSlug/graph/$resourceId",
    shouldThrow: false,
  });

  const stage = useStageManifestChange(projectId);
  const removeCompose = useMutation({
    ...orpc.compose.delete.mutationOptions(),
    onError: (err) => toast.error(toastMessage(err, "Failed to delete")),
  });

  const finish = (node: ResourceFlowNode) => {
    onClose();
    const params = panelMatch?.params;
    // The $resourceId param is either the real resource id or the node id
    // (`${kind}:${name}`) for a not-yet-applied ghost, match both.
    if (!params) return;
    if (params.resourceId !== node.id && params.resourceId !== node.data.resourceId) return;
    void navigate({
      to: "/$orgSlug/$projectSlug/graph",
      params: { orgSlug: params.orgSlug, projectSlug: params.projectSlug },
    });
  };

  const confirmDelete = () => {
    if (!target) return;
    const node = target;
    const { kind, name } = node.data;

    if (kind === "compose") {
      if (!node.data.projectId || !node.data.resourceId) return;
      // Fire and let go. Tearing a stack down takes as long as it takes, and
      // the operator decided the moment they typed the name — holding them in
      // a modal until every container is gone makes them wait on a machine
      // that no longer needs them. The node carries the state instead: marked
      // `deleting` (destructive comet) until its resource is gone, then gone.
      markDeleting(projectId, [node.id]);
      finish(node);
      removeCompose.mutate(
        { projectId: node.data.projectId, resourceId: node.data.resourceId },
        {
          onSuccess: () => {
            toast.success(`Deleted ${name}`);
            // Drop the row now rather than waiting out the poll: the mark is
            // cleared by the node disappearing, so this is what ends it.
            void invalidateManifestConsumers(projectId);
          },
          // Nothing was destroyed, so the node must stop looking doomed. The
          // mutation's own onError carries the toast.
          onError: () => clearDeleting(projectId, node.id),
        },
      );
      return;
    }

    stage.mutate(
      (current) => {
        if (kind === "database") {
          const remaining = { ...current.databases };
          delete remaining[name];
          return { ...current, databases: remaining };
        }
        const remaining = { ...current.services };
        delete remaining[name];
        return { ...current, services: remaining };
      },
      { onSuccess: () => finish(node) },
    );
  };

  const copy = target ? DELETE_COPY[target.data.kind] : undefined;
  const pending = stage.isPending || removeCompose.isPending;

  return (
    <TypedConfirmDialog
      open={target != null && copy != null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      title={`Delete ${target?.data.name ?? "this resource"}?`}
      description={copy?.description ?? ""}
      // Same type-the-name gate the danger zones use. A stray right-click must
      // never make destroying something EASIER than it is today.
      confirmPhrase={target?.data.name ?? ""}
      confirmLabel="Delete"
      pendingLabel={copy?.pendingLabel}
      pending={pending}
      onConfirm={confirmDelete}
    />
  );
}
