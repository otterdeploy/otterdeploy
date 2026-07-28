/**
 * Adapts the graph's node list into the clone dialog's candidate list.
 *
 * Split out of GraphCanvas purely for its line budget — the mapping is the
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

const CLONEABLE = new Set(["service", "database", "compose"]);

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
  // A ghost or unapplied node has no resourceId — there is nothing to copy.
  const candidates: CloneCandidate[] = nodes
    .filter((n) => !!n.data.resourceId && CLONEABLE.has(n.data.kind))
    .map((n) => ({
      resourceId: n.data.resourceId as string,
      name: n.data.name,
      kind: n.data.kind as CloneCandidate["kind"],
    }));

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
