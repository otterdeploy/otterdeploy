/**
 * Adapts the graph's node list into the clone dialog's candidate list.
 *
 * Split out of GraphCanvas purely for its line budget: the mapping is the
 * only thing here. Every applied node is offered, not just the one that was
 * right-clicked: cloning a service without the database it references is the
 * mistake this dialog exists to catch, and it can only be caught if the
 * database is on screen to tick.
 */

import {
  CloneDialog,
  type CloneCandidate,
} from "@/features/projects/components/graph/clone-dialog";
import type { ResourceFlowNode } from "@/features/projects/components/graph/resource-node-types";

function cloneableKind(kind: ResourceFlowNode["data"]["kind"]): CloneCandidate["kind"] | null {
  return kind === "service" || kind === "database" || kind === "compose" ? kind : null;
}

export function GraphCloneDialog({
  projectId,
  nodes,
  target,
  onClose,
}: {
  projectId: string;
  nodes: ResourceFlowNode[];
  /** The node the menu was opened on, or null when the dialog is closed. */
  target: ResourceFlowNode | null;
  onClose: () => void;
}) {
  // A ghost or unapplied node has no resourceId. There is nothing to copy.
  const candidates: CloneCandidate[] = nodes.flatMap((n) => {
    const { resourceId, name } = n.data;
    const kind = cloneableKind(n.data.kind);
    if (!resourceId || !kind) return [];
    return [{ resourceId, name, kind }];
  });

  return (
    <CloneDialog
      projectId={projectId}
      candidates={candidates}
      initialSelection={target?.data.resourceId ? [target.data.resourceId] : []}
      open={target !== null}
      onOpenChange={(open) => !open && onClose()}
    />
  );
}
