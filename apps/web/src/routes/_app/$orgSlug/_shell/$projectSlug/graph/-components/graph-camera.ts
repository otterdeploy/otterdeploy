/**
 * Camera helpers for GraphCanvas, extracted to keep the route file under the
 * line cap: centering a clicked node in the visible strip, and refitting the
 * whole graph when the detail panel closes.
 */
import { useEffect, useRef } from "react";

import { useMatch, useParams, type useRouter } from "@tanstack/react-router";
import { useReactFlow, type Node } from "@xyflow/react";

import { CARD_W } from "./laid-out-nodes";

type Router = ReturnType<typeof useRouter>;

// Approx card dimensions for refocus math. Keep in sync with ResourceNode size.
const CARD_H = 200;
// Side panel covers the right N/D of the canvas. Keep in sync with the panel's
// Tailwind width class in graph/$resourceId.tsx.
/** The drawer's share of the canvas at the current viewport: `xl:w-3/5`, `lg:w-4/5`
 *  (see panel-shell.tsx). Read live rather than fixed, so the card lands in the
 *  strip that is actually left beside the drawer. The old constant (3/7) belonged
 *  to a width the drawer no longer has, and the card it "kept visible" ended up
 *  under the panel. */
function panelWidthRatio(): number {
  if (typeof window === "undefined") return 3 / 5;
  const w = window.innerWidth;
  if (w >= 1280) return 3 / 5;
  if (w >= 1024) return 4 / 5;
  return 1;
}
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
  const shiftRatio = panelWidthRatio() / 2;
  const xOffset = (canvasWidth * shiftRatio) / FOCUS_ZOOM;
  void setCenter(targetX + xOffset, targetY, { zoom: FOCUS_ZOOM, duration: 400 });
}

/**
 * Keep the camera on whichever resource the drawer is showing.
 *
 * Focusing used to live in the canvas's click handler alone, so the camera
 * only moved when you clicked a card. Every other way into the panel — the
 * resource switcher, the stack member strip, the breadcrumb, an activity
 * link, browser back/forward, a reloaded deep link — left it parked wherever
 * the last click had put it, showing one resource while the panel described
 * another.
 *
 * Watching the route param covers all of those at once, the click included:
 * the click navigates, this pans.
 */
export function useFocusOpenResource(nodes: Node[], setCenter: SetCenter): void {
  const params = useParams({ strict: false });
  const resourceId = params.resourceId;
  // What we last panned to, so a poll re-rendering `nodes` every five seconds
  // doesn't re-pan (and fight an operator who has since scrolled away).
  const focused = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!resourceId) {
      // Panel closed. Forget, so reopening the same resource pans again
      // rather than sitting still because it was the last one focused.
      focused.current = undefined;
      return;
    }
    if (resourceId === focused.current) return;
    // A staged-create ghost has no resource id yet and is addressed by node id.
    const node = nodes.find((n) => n.data.resourceId === resourceId || n.id === resourceId);
    // Not laid out yet (deep link: the panel's route resolves before the
    // canvas has nodes). Leave `focused` unset so the next render retries,
    // instead of recording a pan that never happened.
    if (!node) return;
    focused.current = resourceId;
    focusNodeInView(node, setCenter);
  }, [resourceId, nodes, setCenter]);
}

/** Preload a node's target route's code-split chunk (and float its data
 *  prefetch) on hover, so a subsequent click mounts the drawer with no
 *  network wait. Mirrors the target computation in GraphCanvas's onNodeClick.
 *  A preview satellite routes to its own detail page, everything else to
 *  the generic $resourceId route (by resourceId, or by node id for a
 *  pending-create ghost that has none yet). Best-effort: a rejected/
 *  cancelled preload must never surface. */
export function preloadNodeRoute(
  node: Node,
  router: Router,
  params: { orgSlug: string; projectSlug: string },
): void {
  // `node.data` is React Flow's loose record here, so this compares the marker
  // as text rather than through `isRemoving`. Both values mean the same thing:
  // the node is on its way out, there is nothing to open.
  if (node.data.pending === "delete" || node.data.pending === "deleting") return;
  if (node.data.kind === "preview") {
    const previewId = previewIdOf(node.data);
    if (previewId !== null && previewId.length > 0) {
      void router
        .preloadRoute({
          to: "/$orgSlug/$projectSlug/graph/preview/$previewId",
          params: { ...params, previewId },
        })
        .catch(() => {});
    }
    return;
  }
  const resourceId = typeof node.data.resourceId === "string" ? node.data.resourceId : node.id;
  void router
    .preloadRoute({
      to: "/$orgSlug/$projectSlug/graph/$resourceId",
      params: { ...params, resourceId },
    })
    .catch(() => {});
}

/** xyflow hands `preloadNodeRoute` the generic `Node`, whose `data` is
 *  `Record<string, unknown>`, so the preview satellite's id is read with real
 *  narrowing rather than a cast of `data.preview`. */
function previewIdOf(data: Node["data"]): string | null {
  const preview = data.preview;
  if (typeof preview !== "object" || preview === null) return null;
  if (!("id" in preview) || typeof preview.id !== "string") return null;
  return preview.id;
}

/**
 * Bring a newly-created node into view.
 *
 * Layout places a new node wherever dagre decides, which is frequently outside
 * the current viewport, so creating a resource appeared to do nothing at all:
 * the card existed, just off-screen, with no cue about where. `fitView` only
 * ran on mount and on panel close, never on a node appearing.
 *
 * Only acts when the new node is actually off-screen. Refitting unconditionally
 * would yank the camera (and the user's chosen zoom) on every create, including
 * the common case where the card landed somewhere already visible.
 */
export function useRevealNewNodes(
  nodes: Node[],
  fitView: ReturnType<typeof useReactFlow>["fitView"],
  getViewport: ReturnType<typeof useReactFlow>["getViewport"],
): void {
  // Undefined until the first pass, so the initial load, which `fitView`
  // already frames: isn't mistaken for a burst of new nodes.
  const seen = useRef<Set<string> | undefined>(undefined);
  useEffect(() => {
    const ids = new Set(nodes.map((n) => n.id));
    const previous = seen.current;
    seen.current = ids;
    if (!previous) return;
    const fresh = nodes.filter((n) => !previous.has(n.id));
    if (fresh.length === 0) return;
    if (fresh.every((n) => isNodeOnScreen(n, getViewport()))) return;
    void fitView({ padding: 0.2, duration: 400 });
  }, [nodes, fitView, getViewport]);
}

/** Is the node's box inside the visible canvas, in screen space? */
function isNodeOnScreen(node: Node, viewport: { x: number; y: number; zoom: number }): boolean {
  const wrapper = document.querySelector(".react-flow");
  const width = wrapper?.clientWidth ?? 0;
  const height = wrapper?.clientHeight ?? 0;
  // Can't measure the canvas. Assume off-screen so we reveal rather than
  // silently leave the node somewhere the user can't find.
  if (!width || !height) return false;
  const w = node.measured?.width ?? CARD_W;
  const h = node.measured?.height ?? CARD_H;
  const left = node.position.x * viewport.zoom + viewport.x;
  const top = node.position.y * viewport.zoom + viewport.y;
  return (
    left >= 0 && top >= 0 && left + w * viewport.zoom <= width && top + h * viewport.zoom <= height
  );
}

/** Whether a right-hand detail panel (resource or preview) is open, and, on the
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
