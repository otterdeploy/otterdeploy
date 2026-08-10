/**
 * State + mutation glue for the graph's right-click context menus, extracted
 * out of the route's GraphCanvas so that component stays under the
 * line/complexity caps. Restart/redeploy reuse the exact same oRPC surfaces
 * + toasts as the node's own hover toolbar (resource-card-node.tsx) and
 * compose's own Redeploy button (compose/panel.tsx). Same action, just
 * reachable without hovering/opening the panel first. Delete acts in place
 * too: it raises the confirm dialog over the graph rather than routing to a
 * Settings tab. It still implements no new delete logic. This hook only
 * holds the pending-delete target, and graph-node-delete.tsx runs each kind's
 * existing danger-zone path behind the same type-the-name confirm.
 */
import { useState } from "react";

import type { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import type { useReactFlow } from "@xyflow/react";
import { toast } from "sonner";

import type { ProjectSlug } from "@otterdeploy/shared/id";

import type {
  GraphContextMenuActions,
  GraphContextMenuTarget,
} from "@/features/projects/components/graph/graph-context-menu";
import type { ResourceFlowNode } from "@/features/projects/components/graph/resource-node-types";
import type { useResourceOverlay } from "@/features/projects/components/new-resource/overlay-provider";
import { copyToClipboard } from "@/shared/lib/clipboard";
import { toastMessage } from "@/shared/lib/errors";
import { orpc } from "@/shared/server/orpc";

import { usePreviewActions } from "./preview-panel/use-preview-actions";

export interface UseGraphContextMenuArgs {
  /** Needed for the preview lifecycle mutations, which are project-scoped. */
  projectId: string;
  orgSlug: string;
  projectSlug: ProjectSlug;
  navigate: ReturnType<typeof useNavigate>;
  fitView: ReturnType<typeof useReactFlow>["fitView"];
  overlay: ReturnType<typeof useResourceOverlay>;
  /** Same navigation a left-click uses. Reused so "Open" behaves identically. */
  openNode: (node: ResourceFlowNode) => void;
}

export function useGraphContextMenu({
  projectId,
  orgSlug,
  projectSlug,
  navigate,
  fitView,
  overlay,
  openNode,
}: UseGraphContextMenuArgs) {
  const [target, setTarget] = useState<GraphContextMenuTarget | null>(null);
  // The node whose delete confirm is open. Held here (not in the menu) because
  // the menu unmounts the moment Delete is clicked. GraphCanvas renders
  // GraphNodeDeleteDialog with this as a sibling of the menu.
  const [deleteTarget, setDeleteTarget] = useState<ResourceFlowNode | null>(null);
  // Same reason as deleteTarget: the menu unmounts on click, so the dialog is
  // rendered as its sibling by GraphCanvas.
  const [cloneTarget, setCloneTarget] = useState<ResourceFlowNode | null>(null);
  const [renameTarget, setRenameTarget] = useState<ResourceFlowNode | null>(null);
  const close = () => setTarget(null);
  const previewActions = usePreviewActions(projectId);

  const dbRestart = useMutation({
    ...orpc.project.resource.database.postgres.restart.mutationOptions(),
    onSuccess: () => toast.success("Restarting…", { description: "Track progress in the Deployments tab." }),
    onError: (err) => toast.error(toastMessage(err, "Failed to restart")),
  });
  const serviceRestart = useMutation({
    ...orpc.service.restart.mutationOptions(),
    onSuccess: () => toast.success("Restarting…", { description: "Track progress in the Deployments tab." }),
    onError: (err) => toast.error(toastMessage(err, "Failed to restart")),
  });
  const composeRedeploy = useMutation({
    ...orpc.compose.redeploy.mutationOptions(),
    onSuccess: () =>
      toast.success("Redeploying stack…", { description: "Track progress in the Deployments tab." }),
    onError: (err) => toast.error(toastMessage(err, "Failed to redeploy")),
  });

  const actions: GraphContextMenuActions = {
    onOpen: (node) => {
      close();
      openNode(node);
    },
    onLogs: (node) => {
      close();
      // Services get the richer, filterable project Logs page; databases and
      // compose stacks have no per-service log stream there (their container
      // logs live on the resource panel's own Deployments tab instead. The
      // panel opens there by default already).
      if (node.data.kind === "service" && node.data.resourceId) {
        void navigate({
          to: "/$orgSlug/$projectSlug/logs",
          params: { orgSlug, projectSlug },
          search: { service: node.data.resourceId, source: "runtime" },
        });
        return;
      }
      openNode(node);
    },
    onRestart: (node) => {
      close();
      if (!node.data.projectId || !node.data.resourceId) return;
      const args = { projectId: node.data.projectId, resourceId: node.data.resourceId };
      if (node.data.kind === "database") dbRestart.mutate(args);
      else if (node.data.kind === "service") serviceRestart.mutate(args);
      else if (node.data.kind === "compose") composeRedeploy.mutate(args);
    },
    // Preview lifecycle. Reuses the panel's own mutations rather than
    // re-implementing them, so a rebuild from the graph and a rebuild from
    // Settings are literally the same call with the same toasts.
    onPreviewRebuild: (previewId: string) => {
      close();
      previewActions.rebuild.mutate({ projectId, previewId });
    },
    onPreviewPause: (previewId: string) => {
      close();
      previewActions.pause.mutate({ projectId, previewId });
    },
    onPreviewResume: (previewId: string) => {
      close();
      previewActions.resume.mutate({ projectId, previewId });
    },
    onPreviewKeepAlive: (previewId: string, pinned: boolean) => {
      close();
      previewActions.keepAlive.mutate({ projectId, previewId, keepAlive: pinned });
    },
    onCopyUrl: (url: string) => {
      close();
      void copyToClipboard(url).then((ok) => {
        if (ok) toast.success("Copied preview URL");
      });
    },
    onCopyHostname: (node) => {
      close();
      if (!node.data.internalHostname) return;
      void copyToClipboard(node.data.internalHostname).then((ok) => {
        if (ok) toast.success("Copied internal hostname");
      });
    },
    onDelete: (node) => {
      close();
      setDeleteTarget(node);
    },
    onRename: (node) => {
      close();
      setRenameTarget(node);
    },
    onClone: (node) => {
      close();
      // Seeds the dialog's selection; the operator widens it there. Cloning a
      // service without its database is the common mistake, and the dialog is
      // where that gets surfaced.
      setCloneTarget(node);
    },
    onNewService: () => {
      close();
      overlay.setOpen(true);
    },
    onFitView: () => {
      close();
      void fitView({ padding: 0.2, duration: 400 });
    },
  };

  const onNodeContextMenu = (event: React.MouseEvent, node: { data: unknown; id: string }) => {
    event.preventDefault();
    // React Flow's generic handler types the node as the untyped base
    // `Node`: this canvas only ever renders `ResourceNode`, which always
    // gets `ResourceNodeData` (see nodeTypes in graph-flow.tsx).
    setTarget({
      kind: "node",
      node: node as ResourceFlowNode,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const onPaneContextMenu = (event: React.MouseEvent | MouseEvent) => {
    event.preventDefault();
    setTarget({ kind: "pane", x: event.clientX, y: event.clientY });
  };

  return {
    target,
    onOpenChange: (open: boolean) => {
      if (!open) close();
    },
    actions,
    onNodeContextMenu,
    onPaneContextMenu,
    deleteTarget,
    closeDelete: () => setDeleteTarget(null),
    cloneTarget,
    closeClone: () => setCloneTarget(null),
    renameTarget,
    closeRename: () => setRenameTarget(null),
  };
}
