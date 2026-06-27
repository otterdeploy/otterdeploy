import { type ComponentProps } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";

import { ResourceNode } from "@/features/projects/components/graph/resource-node";

const nodeTypes = { resource: ResourceNode };

// Edges stay derived — dagre/data own them, so their change handler is inert.
const noopChange = () => {};

type ReactFlowProps = ComponentProps<typeof ReactFlow>;

/** Presentational React Flow canvas. All graph derivation + interaction state
 *  lives in GraphCanvas; this just renders the node/edge lists and forwards the
 *  drag/click handlers React Flow fires. */
export function GraphFlow({
  nodes,
  edges,
  onNodesChange,
  onNodeClick,
  onNodeDragStart,
  onNodeDragStop,
}: {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange[]) => void;
  onNodeClick: NonNullable<ReactFlowProps["onNodeClick"]>;
  onNodeDragStart: NonNullable<ReactFlowProps["onNodeDragStart"]>;
  onNodeDragStop: NonNullable<ReactFlowProps["onNodeDragStop"]>;
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
    >
      <Background gap={20} size={1} />
      <Controls
        showInteractive={false}
        position="bottom-right"
        className="rounded-md! border! border-border/40! bg-background/80! shadow-sm! backdrop-blur! [&_button]:border-border/40! [&_button]:bg-transparent! [&_button]:text-muted-foreground! hover:[&_button]:text-foreground!"
      />
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
