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
  PauseIcon,
  PinIcon,
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
  /** Preview lifecycle, reachable without opening the panel's Settings tab.
   *  Teardown is deliberately absent — it is destructive and keeps its
   *  type-to-confirm surface in the panel. */
  onPreviewRebuild: (previewId: string) => void;
  onPreviewPause: (previewId: string) => void;
  onPreviewResume: (previewId: string) => void;
  onPreviewKeepAlive: (previewId: string, pinned: boolean) => void;
  onCopyUrl: (url: string) => void;
  onLogs: (node: ResourceFlowNode) => void;
  onRestart: (node: ResourceFlowNode) => void;
  onCopyHostname: (node: ResourceFlowNode) => void;
  onDelete: (node: ResourceFlowNode) => void;
  onClone: (node: ResourceFlowNode) => void;
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

/**
 * A preview's own actions. These all existed already — buried in the panel's
 * Settings tab, three clicks and a tab-switch from the graph — so the satellite
 * offered nothing but "Open" on right-click.
 *
 * Teardown is deliberately NOT here. It destroys an environment and keeps its
 * type-to-confirm dialog in the panel; a destructive action one careless click
 * from a right-click menu is a different risk from a convenient one.
 */
function PreviewMenuItems({
  preview,
  node,
  actions,
}: {
  preview: NonNullable<ResourceFlowNode["data"]["preview"]>;
  node: ResourceFlowNode;
  actions: GraphContextMenuActions;
}) {
  const pinned = preview.pinned === true;
  return (
    <>
      <DropdownMenuItem onClick={() => actions.onOpen(node)}>
        <HugeiconsIcon icon={SquareArrowExpand01Icon} strokeWidth={2} />
        Open details
      </DropdownMenuItem>
      {preview.url ? (
        <DropdownMenuItem
          onClick={() => window.open(preview.url as string, "_blank", "noopener")}
        >
          <HugeiconsIcon icon={SquareArrowExpand01Icon} strokeWidth={2} />
          Visit preview
        </DropdownMenuItem>
      ) : null}
      {preview.prUrl ? (
        <DropdownMenuItem
          onClick={() => window.open(preview.prUrl as string, "_blank", "noopener")}
        >
          <HugeiconsIcon icon={SquareArrowExpand01Icon} strokeWidth={2} />
          Open pull request
        </DropdownMenuItem>
      ) : null}
      {preview.url ? (
        <DropdownMenuItem onClick={() => actions.onCopyUrl(preview.url as string)}>
          <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} />
          Copy preview URL
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => actions.onPreviewRebuild(preview.id)}>
        <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} />
        Rebuild from latest commit
      </DropdownMenuItem>
      {preview.paused ? (
        <DropdownMenuItem onClick={() => actions.onPreviewResume(preview.id)}>
          <HugeiconsIcon icon={PlayIcon} strokeWidth={2} />
          Resume
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem onClick={() => actions.onPreviewPause(preview.id)}>
          <HugeiconsIcon icon={PauseIcon} strokeWidth={2} />
          Pause (free resources)
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={() => actions.onPreviewKeepAlive(preview.id, !pinned)}>
        <HugeiconsIcon icon={PinIcon} strokeWidth={2} />
        {pinned ? "Allow idle teardown" : "Keep alive (pin)"}
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
  if (data.kind === "preview" && data.preview) {
    return <PreviewMenuItems preview={data.preview} node={node} actions={actions} />;
  }
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
      {isReal && (
        <DropdownMenuItem onClick={() => actions.onClone(node)}>
          <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} />
          Clone…
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
