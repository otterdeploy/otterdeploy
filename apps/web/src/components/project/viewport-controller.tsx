import { useEffect, useRef } from "react";
import { useReactFlow } from "@xyflow/react";
import { useMatchRoute } from "@tanstack/react-router";

export function ViewportController() {
  const { setCenter, getNode, getNodes, getInternalNode, getViewport, fitView } = useReactFlow();
  const match = useMatchRoute();

  const serviceMatch = match({ from: "/projects/$projectId/service/$serviceId" });
  const volumeMatch = match({ from: "/projects/$projectId/volume/$volume" });

  const showChild = !!(serviceMatch || volumeMatch);
  const activeId = serviceMatch ? serviceMatch.serviceId : volumeMatch ? volumeMatch.volume : null;

  const prevShowChildRef = useRef(showChild);

  useEffect(() => {
    if (showChild && activeId) {
      let targetNode = getNode(activeId);

      if (!targetNode) {
        const parent = getNodes().find((n) =>
          (n.data as { attachments?: { id: string }[] })?.attachments?.some(
            (a) => a.id === activeId,
          ),
        );
        if (parent) targetNode = parent;
      }

      if (targetNode) {
        const { zoom } = getViewport();
        const targetZoom = Math.min(zoom, 0.85);
        const panelWidthPx = window.innerWidth * 0.6;
        const nodeWidth = targetNode.measured?.width ?? 180;
        const nodeHeight = targetNode.measured?.height ?? 80;

        // Use absolute position (accounts for parent group offset)
        const internalNode = getInternalNode(targetNode.id);
        const absX = internalNode?.internals.positionAbsolute.x ?? targetNode.position.x;
        const absY = internalNode?.internals.positionAbsolute.y ?? targetNode.position.y;

        const nodeCenterX = absX + nodeWidth / 2;
        const nodeCenterY = absY + nodeHeight / 2;

        // Shift the center so the node appears in the visible area left of the panel.
        // panelWidthPx / targetZoom converts screen pixels to flow coordinates.
        // Divide by 2 to center the node within the remaining visible space.
        setCenter(nodeCenterX + panelWidthPx / targetZoom / 2, nodeCenterY, {
          duration: 300,
          zoom: targetZoom,
        });
      }
    }

    if (!showChild && prevShowChildRef.current) {
      fitView({ duration: 300, padding: 0.2 });
    }

    prevShowChildRef.current = showChild;
  }, [showChild, activeId, setCenter, getNode, getNodes, getInternalNode, getViewport, fitView]);

  return null;
}
