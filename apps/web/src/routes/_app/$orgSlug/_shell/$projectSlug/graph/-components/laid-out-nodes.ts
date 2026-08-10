/**
 * Pure node-positioning for GraphCanvas, extracted so the component stays under
 * the function/line caps. `computeLaidOutNodes` is the per-render layout memo's
 * body; `resolveDroppedPositions` is the on-drop collision bounce. Both are
 * behaviour-identical to their inline originals: they read/write the two
 * render-cache refs the caller owns (renderedNodes/layoutCache).
 */
import type { Node } from "@xyflow/react";

import {
  incrementalLayout,
  NODE_WIDTH,
  resolveAllOverlaps,
  resolveNewCollisions,
  topologySignature,
  type SizeLookup,
  type XY,
} from "@/features/projects/components/graph/layout-graph";
import { orpc } from "@/shared/server/orpc";

import type { useGraphModel } from "./graph-model";

// Satellite placement measures the same card the layout does. Re-exported
// rather than duplicated, so shrinking the card can't leave the two disagreeing.
export const CARD_W = NODE_WIDTH;

type Model = ReturnType<typeof useGraphModel>;
type LiveNode = Model["liveNodes"][number];
type LiveEdge = Model["liveEdges"][number];

interface LayoutCacheRef {
  current: { sig: string; positions: Map<string, XY> };
}

interface LaidOutArgs {
  dragging: boolean;
  dragged: Map<string, XY>;
  liveNodes: LiveNode[];
  liveEdges: LiveEdge[];
  renderedNodesRef: { current: LiveNode[] };
  layoutCache: LayoutCacheRef;
  /** Sizes React Flow has measured, so the final overlap pass separates the
   *  cards that are actually on screen rather than dagre's estimates of them. */
  measured?: SizeLookup;
}

/** Final positions for the core (non-satellite) cards: the operator's dragged
 *  or persisted spot when there is one, dagre's otherwise, then settled so no
 *  two of them overlap. The settle is what makes the guarantee hold for
 *  positions that never went through layout at all (a replayed `graphLayout`,
 *  a card that grew after placement); see resolveAllOverlaps. */
function settleCorePositions(
  core: LiveNode[],
  dragged: Map<string, XY>,
  positions: Map<string, XY>,
  measured?: SizeLookup,
): Map<string, XY> {
  const final = new Map<string, XY>();
  for (const n of core) {
    const pos = dragged.get(n.id) ?? positions.get(n.id);
    if (pos) final.set(n.id, pos);
  }
  resolveAllOverlaps(final, core, measured);
  return final;
}

/** The node list handed to React Flow: mid-drag it freezes the last-rendered set
 *  and moves only the dragged card(s); otherwise it (re)lays out on a genuine
 *  topology change and overlays dragged/dagre positions. Mutates the two render-
 *  cache refs exactly as the original inline memo did. */
export function computeLaidOutNodes({
  dragging,
  dragged,
  liveNodes,
  liveEdges,
  renderedNodesRef,
  layoutCache,
  measured,
}: LaidOutArgs): LiveNode[] {
  if (dragging && renderedNodesRef.current.length > 0) {
    // Mid-drag: keep the exact node set we last rendered (no add/remove, so
    // nothing flickers out) and move only the node(s) actually under the cursor.
    // A node whose position changed this frame gets a fresh identity; every
    // other card keeps its reference, so React Flow re-renders only the dragged
    // wrapper, and thanks to the memoized renderers, only its transform.
    const out = renderedNodesRef.current.map((n) => {
      const pos = dragged.get(n.id);
      if (!pos || (pos.x === n.position.x && pos.y === n.position.y)) return n;
      return { ...n, position: pos };
    });
    renderedNodesRef.current = out;
    return out;
  }
  // Preview satellites are excluded from dagre + the topology signature, they
  // hang right of their parent service card, so a PR opening/closing never
  // relayouts the core graph.
  const core = liveNodes.filter((n) => n.data.kind !== "preview");
  const coreEdges = liveEdges.filter((e) => !e.target.startsWith("preview:"));
  const sig = topologySignature(core, coreEdges);
  if (sig !== layoutCache.current.sig) {
    layoutCache.current = {
      sig,
      positions: incrementalLayout(core, coreEdges, layoutCache.current.positions, measured),
    };
  }
  // A node renders where you last dragged it, else where dagre first placed it,
  // then the whole set is settled, so neither source can leave an overlap.
  // Settled positions stay OUT of the layout cache: the cache is the record of
  // where a node was put (by dagre or by the operator), and the settle is a
  // correction applied on top of it, recomputed from scratch every render.
  const positions = settleCorePositions(core, dragged, layoutCache.current.positions, measured);

  // Satellites hang off their parent instead of being laid out, so they can
  // land on an unrelated card. They're separated last, against the settled core
  // (fixed) and each other: a PR card yields, a real resource never does.
  const satelliteIndex = new Map<string, number>();
  for (const n of liveNodes) {
    if (n.data.kind !== "preview" || !n.data.preview) continue;
    const dpos = dragged.get(n.id);
    if (dpos) {
      positions.set(n.id, dpos);
      continue;
    }
    const parentId = n.data.preview.parentId;
    const i = satelliteIndex.get(parentId) ?? 0;
    satelliteIndex.set(parentId, i + 1);
    const parent = positions.get(parentId);
    if (!parent) continue;
    positions.set(n.id, { x: parent.x + CARD_W + 64, y: parent.y + i * 112 });
  }
  resolveNewCollisions(positions, liveNodes, (id) => id.startsWith("preview:"), measured);

  const out = liveNodes.map((n) => {
    const pos = positions.get(n.id);
    return pos ? { ...n, position: pos } : n;
  });
  renderedNodesRef.current = out;
  return out;
}

/** Bounce dropped card(s) to the nearest clear spot so a drop never leaves an
 *  overlap. Runs once on release over the core cards only (satellites may
 *  overlap); every non-dropped node is a fixed obstacle. */
export function resolveDroppedPositions(
  renderedNodes: LiveNode[],
  moved: Array<Pick<Node, "id" | "position" | "data">>,
  measured?: SizeLookup,
): Map<string, XY> {
  const movedIds = new Set(moved.map((m) => m.id));
  const dropPos = new Map(moved.map((m) => [m.id, m.position] as const));
  const coreRendered = renderedNodes.filter((n) => n.data.kind !== "preview");
  const resolved = new Map<string, XY>();
  for (const rn of coreRendered) {
    const p = dropPos.get(rn.id) ?? rn.position;
    resolved.set(rn.id, { x: p.x, y: p.y });
  }
  resolveNewCollisions(resolved, coreRendered, (id) => movedIds.has(id), measured);
  return resolved;
}

/** Commit a drop's resolved (clear) position(s): update local state so the
 *  card(s) render there immediately, mirror non-satellite nodes into the
 *  layout cache so a later relayout pins from where they ended up, and
 *  best-effort persist to the project's saved layout (satellites are
 *  ephemeral (PR lifetime only) so they never persist). Extracted out of
 *  GraphCanvas's onNodeDragStop so that handler stays a one-liner. */
export function commitNodeDrop(args: {
  projectId: string;
  moved: Array<Pick<Node, "id" | "position" | "data">>;
  resolved: Map<string, XY>;
  layoutCache: LayoutCacheRef;
  setDragged: (updater: (prev: Map<string, XY>) => Map<string, XY>) => void;
}): void {
  const { projectId, moved, resolved, layoutCache, setDragged } = args;
  setDragged((prev) => {
    const next = new Map(prev);
    for (const m of moved) {
      const pos = resolved.get(m.id) ?? m.position;
      next.set(m.id, pos);
      if (m.data.kind !== "preview") {
        layoutCache.current.positions.set(m.id, pos);
      }
    }
    return next;
  });

  const persist = moved.filter((m) => m.data.kind !== "preview");
  if (persist.length === 0) return;
  void orpc.project.saveGraphLayout
    .call({
      id: projectId,
      positions: Object.fromEntries(
        persist.map((m) => {
          const p = resolved.get(m.id) ?? m.position;
          return [m.id, { x: p.x, y: p.y }];
        }),
      ),
    })
    .catch(() => {});
}
