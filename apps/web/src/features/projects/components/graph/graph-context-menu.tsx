/**
 * Right-click context menus for the graph canvas — one for a resource node
 * (service/database/stack), one for empty canvas. Follows the established
 * "invisible fixed-position trigger + controlled DropdownMenu" pattern from
 * `shared/components/data-grid/data-grid-context-menu.tsx` (the only other
 * context menu in the app) rather than a dedicated context-menu primitive.
 */

import {
  Cancel01Icon,
  Copy01Icon,
  Delete02Icon,
  Loading03Icon,
  PlayIcon,
  PlusSignIcon,
  ScanIcon,
  SquareArrowExpand01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";

import type { ResourceFlowNode } from "./resource-node-types";

/** Where the menu should anchor + what it's for. `null` closes it. */
export type GraphContextMenuTarget =
  | { kind: "node"; node: ResourceFlowNode; x: number; y: number }
  | { kind: "pane"; x: number; y: number };

export interface GraphContextMenuActions {
  onOpen: (node: ResourceFlowNode) => void;
  onLogs: (node: ResourceFlowNode) => void;
  onRestart: (node: ResourceFlowNode) => void;
  onCopyHostname: (node: ResourceFlowNode) => void;
  onDelete: (node: ResourceFlowNode) => void;
  onNewService: () => void;
  onFitView: () => void;
}

/** Node kinds that show a context menu at all — a preview satellite or a
 *  compose sub-service card has its own click affordances and no standalone
 *  resource to act on here. */
function isActionableKind(kind: string): kind is "service" | "database" | "compose" {
  return kind === "service" || kind === "database" || kind === "compose";
}

export function GraphContextMenu({
  target,
  onOpenChange,
  actions,
}: {
  target: GraphContextMenuTarget | null;
  onOpenChange: (open: boolean) => void;
  actions: GraphContextMenuActions;
}) {
  if (!target) return null;

  const triggerStyle: React.CSSProperties = {
    position: "fixed",
    left: `${target.x}px`,
    top: `${target.y}px`,
    width: "1px",
    height: "1px",
    padding: 0,
    margin: 0,
    border: "none",
    background: "transparent",
    pointerEvents: "none",
    opacity: 0,
  };

  return (
    <DropdownMenu open onOpenChange={onOpenChange}>
      <DropdownMenuTrigger style={triggerStyle} />
      <DropdownMenuContent align="start" className="w-56">
        {target.kind === "pane" ? (
          <PaneMenuItems onNewService={actions.onNewService} onFitView={actions.onFitView} />
        ) : (
          <NodeMenuItems node={target.node} actions={actions} />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PaneMenuItems({
  onNewService,
  onFitView,
}: {
  onNewService: () => void;
  onFitView: () => void;
}) {
  return (
    <>
      <DropdownMenuItem onClick={onNewService}>
        <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
        New service…
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onFitView}>
        <HugeiconsIcon icon={ScanIcon} strokeWidth={2} />
        Fit view
      </DropdownMenuItem>
    </>
  );
}

function NodeMenuItems({
  node,
  actions,
}: {
  node: ResourceFlowNode;
  actions: GraphContextMenuActions;
}) {
  const { data } = node;
  if (!isActionableKind(data.kind)) {
    return (
      <DropdownMenuItem onClick={() => actions.onOpen(node)}>
        <HugeiconsIcon icon={SquareArrowExpand01Icon} strokeWidth={2} />
        Open
      </DropdownMenuItem>
    );
  }

  // A ghost (staged, pending create) or an unapplied resource has no
  // resourceId yet — nothing runs, so restart/logs/hostname/delete would be
  // fake affordances. Open still works (it renders the manifest draft).
  const isReal = !!data.resourceId && data.pending !== "delete";
  const restartLabel = data.kind === "compose" ? "Redeploy" : "Restart";
  const canCopyHostname = isReal && !!data.internalHostname;
  const canDelete = isReal && data.pending !== "delete";

  return (
    <>
      <DropdownMenuItem onClick={() => actions.onOpen(node)}>
        <HugeiconsIcon icon={SquareArrowExpand01Icon} strokeWidth={2} />
        Open
      </DropdownMenuItem>
      {isReal && (
        <DropdownMenuItem onClick={() => actions.onLogs(node)}>
          <HugeiconsIcon icon={PlayIcon} strokeWidth={2} />
          Logs
        </DropdownMenuItem>
      )}
      {isReal && (
        <DropdownMenuItem onClick={() => actions.onRestart(node)}>
          <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} />
          {restartLabel}
        </DropdownMenuItem>
      )}
      {canCopyHostname && (
        <DropdownMenuItem onClick={() => actions.onCopyHostname(node)}>
          <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} />
          Copy internal hostname
        </DropdownMenuItem>
      )}
      {canDelete && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => actions.onDelete(node)}>
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            Delete
          </DropdownMenuItem>
        </>
      )}
      {!isReal && (
        <DropdownMenuItem disabled>
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
          Not deployed yet
        </DropdownMenuItem>
      )}
    </>
  );
}
