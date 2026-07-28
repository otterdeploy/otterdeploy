import { type ComponentProps } from "react";

import { PlusSignIcon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  type CoordinateExtent,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";

import { ResourceNode } from "@/features/projects/components/graph/resource-node";
import { Button } from "@/shared/components/ui/button";

import { GraphLegend } from "./graph-legend";
import { formatRps } from "./route-traffic";

const nodeTypes = { resource: ResourceNode };

// Edges stay derived — dagre/data own them, so their change handler is inert.
const noopChange = () => {};

type ReactFlowProps = ComponentProps<typeof ReactFlow>;

/** Rollup for the corner chip — null means "no traffic data, show nothing". */
export interface TrafficSummary {
  totalRps: number;
  worstP95: number;
}

/** Presentational React Flow canvas. All graph derivation + interaction state
 *  lives in GraphCanvas; this just renders the node/edge lists and forwards the
 *  drag/click handlers React Flow fires. `bottomInset` lifts the bottom-anchored
 *  chrome (Controls, legend, re-layout) above the stack drawer. */
export function GraphFlow({
  nodes,
  edges,
  onNodesChange,
  onNodeClick,
  onNodeMouseEnter,
  onNodeDragStart,
  onNodeDragStop,
  onNodeContextMenu,
  onPaneContextMenu,
  traffic,
  onRelayout,
  onNewService,
  bottomInset,
  nodeExtent,
  translateExtent,
}: {
  nodes: Node[];
  edges: Edge[];
  /** Bounds cards may be dragged within, and the box the viewport may pan
   *  inside — see graph-extent.ts for why the canvas is bounded at all. */
  nodeExtent: CoordinateExtent;
  translateExtent: CoordinateExtent;
  onNodesChange: (changes: NodeChange[]) => void;
  onNodeClick: NonNullable<ReactFlowProps["onNodeClick"]>;
  // Hover intent — preloads the clicked-panel route chunk so the drawer opens
  // instantly on click (graph nodes navigate imperatively, so they miss the
  // `<Link>` intent-preload that lists get for free).
  onNodeMouseEnter: NonNullable<ReactFlowProps["onNodeMouseEnter"]>;
  onNodeDragStart: NonNullable<ReactFlowProps["onNodeDragStart"]>;
  onNodeDragStop: NonNullable<ReactFlowProps["onNodeDragStop"]>;
  onNodeContextMenu: NonNullable<ReactFlowProps["onNodeContextMenu"]>;
  onPaneContextMenu: NonNullable<ReactFlowProps["onPaneContextMenu"]>;
  traffic: TrafficSummary | null;
  onRelayout: () => void;
  /** Opens the new-resource wizard — wired to the empty-state CTA below (same
   *  overlay the header's "+ New service" button opens). */
  onNewService: () => void;
  bottomInset: number;
}) {
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={noopChange}
      nodeTypes={nodeTypes}
      nodesDraggable
      nodeExtent={nodeExtent}
      translateExtent={translateExtent}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      // Wider than React Flow's 0.5–2 default: 0.2 lets a large stack fit on
      // one screen, 2.5 keeps a single card readable when zoomed in.
      minZoom={0.2}
      maxZoom={2.5}
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{ type: "smoothstep" }}
      onNodeDragStart={onNodeDragStart}
      onNodeDragStop={onNodeDragStop}
      onNodeClick={onNodeClick}
      onNodeMouseEnter={onNodeMouseEnter}
      onNodeContextMenu={onNodeContextMenu}
      onPaneContextMenu={onPaneContextMenu}
    >
      <Background gap={20} size={1} />
      {/* Overview + jump target. Only meaningful because the canvas is bounded
          (graph-extent.ts): over an infinite plane one stray card shrinks
          everything else to invisible dots. Hidden while the graph is empty —
          an empty rectangle explains nothing.
          Colours are deliberately NOT passed as props: index.css already themes
          `--xy-minimap-*` off the design tokens, and a `nodeColor` prop lands on
          an SVG presentation attribute, where `color-mix()` doesn't resolve —
          which renders the nodes invisible. */}
      {/* Hidden below `sm`: the minimap is ~150px wide, which is 40% of a
          375px canvas — it costs more of the real graph than the overview it
          buys back. Pinch-zoom and the fit-view control cover the same need. */}
      {nodes.length > 0 ? (
        <MiniMap
          position="bottom-left"
          pannable
          zoomable
          ariaLabel="Project graph overview"
          style={{ bottom: bottomInset + 52 }}
          className="hidden transition-[bottom]! duration-200! sm:block"
          nodeBorderRadius={3}
        />
      ) : null}
      <Controls
        showInteractive={false}
        position="bottom-right"
        style={{ bottom: bottomInset }}
        className="rounded-md! border! border-border/40! bg-background/80! shadow-sm! backdrop-blur! transition-[bottom]! duration-200! [&_button]:border-border/40! [&_button]:bg-transparent! [&_button]:text-muted-foreground! hover:[&_button]:text-foreground!"
      />
      {/* Re-run layout — clears the persisted arrangement and hands placement
          back to dagre. Sits just above the Controls stack. */}
      <Panel
        position="bottom-right"
        style={{ bottom: bottomInset + 100 }}
        className="transition-[bottom] duration-200"
      >
        <button
          type="button"
          onClick={onRelayout}
          title="Re-run layout"
          aria-label="Re-run layout — reset saved node positions"
          className="grid size-[26px] place-items-center rounded-md border border-border/40 bg-background/80 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground"
        >
          <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="size-3.5" />
        </button>
      </Panel>
      <Panel
        position="bottom-left"
        style={{ bottom: bottomInset }}
        className="transition-[bottom] duration-200"
      >
        <GraphLegend hasNodes={nodes.length > 0} />
      </Panel>
      {/* Live traffic chip — rendered only when a host actually saw traffic in
          the window; no zeros, no placeholders. */}
      {traffic ? (
        <Panel position="top-left">
          <div className="flex items-center gap-2 rounded-md border border-border/40 bg-background/80 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground shadow-sm backdrop-blur">
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-success motion-safe:animate-pulse"
            />
            <span className="text-foreground/85">{formatRps(traffic.totalRps)} rps</span>
            <span className="h-3 w-px bg-border" />
            <span>
              worst p95 <span className="text-foreground/85">{Math.round(traffic.worstP95)}ms</span>
            </span>
          </div>
        </Panel>
      ) : null}
      {nodes.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-center">
          <div className="flex flex-col gap-1">
            <div className="text-sm font-medium text-muted-foreground">
              No resources yet
            </div>
            <div className="text-xs text-muted-foreground/70">
              Add a service or database to see it on the graph.
            </div>
          </div>
          <Button size="sm" className="pointer-events-auto gap-1.5" onClick={onNewService}>
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
            New service
          </Button>
        </div>
      ) : null}
    </ReactFlow>
  );
}
