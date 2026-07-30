/**
 * The dialogs the node context menu opens.
 *
 * They live here rather than inside the menu because the menu unmounts the
 * instant an item is clicked, and a dialog rendered as its child would go with
 * it. Grouped into one component so GraphCanvas carries one line for "the
 * menu's dialogs" instead of one block per dialog.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import type { ResourceFlowNode } from "@/features/projects/components/graph/resource-node-types";

import { GraphCloneDialog } from "./graph-clone-dialog";
import { GraphRenameDialog } from "./graph-rename-dialog";
import { GraphNodeDeleteDialog } from "./graph-node-delete";

export function GraphNodeDialogs({
  projectId,
  nodes,
  menu,
}: {
  projectId: ProjectId;
  nodes: ResourceFlowNode[];
  /** The context-menu hook's target/close pairs, passed as one object so the
   *  canvas doesn't thread six props through for three dialogs. */
  menu: {
    deleteTarget: ResourceFlowNode | null;
    closeDelete: () => void;
    cloneTarget: ResourceFlowNode | null;
    closeClone: () => void;
    renameTarget: ResourceFlowNode | null;
    closeRename: () => void;
  };
}) {
  return (
    <>
      <GraphNodeDeleteDialog target={menu.deleteTarget} projectId={projectId} onClose={menu.closeDelete} />
      <GraphRenameDialog target={menu.renameTarget} projectId={projectId} onClose={menu.closeRename} />
      <GraphCloneDialog
        projectId={projectId}
        nodes={nodes}
        target={menu.cloneTarget}
        onClose={menu.closeClone}
      />
    </>
  );
}
