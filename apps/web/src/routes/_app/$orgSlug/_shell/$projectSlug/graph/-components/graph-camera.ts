/**
 * Camera helpers for GraphCanvas, extracted to keep the route file under the
 * line cap: centering a clicked node in the visible strip, and refitting the
 * whole graph when the detail panel closes.
 */
import { useEffect, useRef } from "react";

import { useMatch } from "@tanstack/react-router";
import { useReactFlow, type Node } from "@xyflow/react";

import { CARD_W } from "./laid-out-nodes";

// Approx card dimensions for refocus math. Keep in sync with ResourceNode size.
const CARD_H = 200;
// Side panel covers the right N/D of the canvas. Keep in sync with the panel's
// Tailwind width class in graph/$resourceId.tsx.
const PANEL_WIDTH_RATIO = 3 / 7;
const FOCUS_ZOOM = 1.15;

type SetCenter = ReturnType<typeof useReactFlow>["setCenter"];

/** Slide the camera so a clicked node lands centered in the visible left strip
 *  (the area not covered by the detail panel). Measures the real `.react-flow`
 *  wrapper rather than the window so chrome doesn't skew the offset. */
export function focusNodeInView(node: Node, setCenter: SetCenter): void {
  const wrapper = document.querySelector(".react-flow");
  const canvasWidth = wrapper?.clientWidth ?? 0;
  // Center on the node's real measured size (v12 measures after layout).
  const w = node.measured?.width ?? CARD_W;
  const h = node.measured?.height ?? CARD_H;
  const targetX = node.position.x + w / 2;
  const targetY = node.position.y + h / 2;
  if (!canvasWidth) {
    void setCenter(targetX, targetY, { zoom: FOCUS_ZOOM, duration: 400 });
    return;
  }
  const shiftRatio = PANEL_WIDTH_RATIO / 2;
  const xOffset = (canvasWidth * shiftRatio) / FOCUS_ZOOM;
  void setCenter(targetX + xOffset, targetY, { zoom: FOCUS_ZOOM, duration: 400 });
}

/** Whether a right-hand detail panel (resource or preview) is open — and, on the
 *  open→closed transition, refit the whole graph into view so the user gets the
 *  wide overview instead of staying parked on the previously-focused node. */
export function useDetailPanelRefit(
  fitView: ReturnType<typeof useReactFlow>["fitView"],
): boolean {
  const resourceMatch = useMatch({
    from: "/_app/$orgSlug/_shell/$projectSlug/graph/$resourceId",
    shouldThrow: false,
  });
  const previewMatch = useMatch({
    from: "/_app/$orgSlug/_shell/$projectSlug/graph/preview/$previewId",
    shouldThrow: false,
  });
  const panelOpen = !!resourceMatch || !!previewMatch;
  const wasOpen = useRef(panelOpen);
  useEffect(() => {
    if (wasOpen.current && !panelOpen) {
      void fitView({ padding: 0.2, duration: 400 });
    }
    wasOpen.current = panelOpen;
  }, [panelOpen, fitView]);
  return panelOpen;
}
