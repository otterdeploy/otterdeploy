/**
 * How the camera frames the graph.
 *
 * The minimap sits over the canvas's bottom-left corner (graph-flow.tsx), and
 * a symmetric fit could park a card under it: covered, and its clicks landing
 * on the minimap instead. Every fit keeps a strip clear down the left, as wide
 * as the minimap plus its inset, whenever the minimap is shown (it is hidden
 * below `sm`, where that strip would only cost graph). The graph is laid out
 * top-to-bottom, so width is rarely the bound a fit hits and the strip mostly
 * just moves it right.
 */
import type { FitViewOptions } from "@xyflow/react";

/** React Flow's default minimap width. */
const MINIMAP_WIDTH = 200;
/** React Flow's panel inset, plus a gap so a card never touches the minimap. */
const MINIMAP_CLEARANCE = MINIMAP_WIDTH + 15 + 16;
/** The graph's ordinary breathing room (a fraction of the viewport). */
const FIT_PADDING = 0.2;

export function graphFitPadding(): NonNullable<FitViewOptions["padding"]> {
  const minimapShown =
    typeof window !== "undefined" && window.matchMedia("(min-width: 40rem)").matches;
  if (!minimapShown) return FIT_PADDING;
  return {
    top: FIT_PADDING,
    right: FIT_PADDING,
    bottom: FIT_PADDING,
    left: `${MINIMAP_CLEARANCE}px`,
  };
}
