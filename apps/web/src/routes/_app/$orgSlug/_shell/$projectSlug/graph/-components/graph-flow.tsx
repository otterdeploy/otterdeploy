import { type ComponentProps } from "react";

import { RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Background,
  Controls,
  Panel,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";

import { ResourceNode } from "@/features/projects/components/graph/resource-node";

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
  traffic,
  onRelayout,
  bottomInset,
}: {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange[]) => void;
  onNodeClick: NonNullable<ReactFlowProps["onNodeClick"]>;
  // Hover intent — preloads the clicked-panel route chunk so the drawer opens
  // instantly on click (graph nodes navigate imperatively, so they miss the
  // `<Link>` intent-preload that lists get for free).
  onNodeMouseEnter: NonNullable<ReactFlowProps["onNodeMouseEnter"]>;
  onNodeDragStart: NonNullable<ReactFlowProps["onNodeDragStart"]>;
  onNodeDragStop: NonNullable<ReactFlowProps["onNodeDragStop"]>;
  traffic: TrafficSummary | null;
  onRelayout: () => void;
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
      fitView
      fitViewOptions={{ padding: 0.2 }}
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{ type: "smoothstep" }}
      onNodeDragStart={onNodeDragStart}
      onNodeDragStop={onNodeDragStop}
      onNodeClick={onNodeClick}
      onNodeMouseEnter={onNodeMouseEnter}
    >
      <Background gap={20} size={1} />
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
        <GraphLegend />
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
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 text-center">
          <div className="text-sm font-medium text-muted-foreground">
            No resources yet
          </div>
          <div className="text-xs text-muted-foreground/70">
            Add a service or database to see it on the graph.
          </div>
        </div>
      ) : null}
    </ReactFlow>
  );
}
