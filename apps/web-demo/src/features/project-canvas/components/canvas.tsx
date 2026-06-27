import { useMemo } from "react";

import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { CanvasNode } from "../types";

import { CanvasControls } from "./canvas-controls";
import { DatabaseNode } from "./database-node";
import { GroupNode } from "./group-node";
import { RoutingNode } from "./routing-node";
import { ServiceNode } from "./service-node";
import { VolumeNode } from "./volume-node";

const nodeTypes: NodeTypes = {
  group: GroupNode,
  service: ServiceNode,
  database: DatabaseNode,
  volume: VolumeNode,
  routing: RoutingNode,
};

interface Props {
  nodes: ReadonlyArray<CanvasNode>;
  selectedNodeId: string | null;
  onSelectNode: (node: CanvasNode | null) => void;
}

function CanvasInner({ nodes, selectedNodeId, onSelectNode }: Props) {
  const decoratedNodes = useMemo<Node[]>(
    () => nodes.map((n) => ({ ...n, selected: n.id === selectedNodeId })),
    [nodes, selectedNodeId],
  );

  const handleNodeClick: NodeMouseHandler = (_, node) => {
    onSelectNode((node as CanvasNode) ?? null);
  };

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={decoratedNodes}
        nodeTypes={nodeTypes}
        edges={[]}
        fitView
        proOptions={{ hideAttribution: true }}
        onNodeClick={handleNodeClick}
        onPaneClick={() => onSelectNode(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={14} size={1} />
        <CanvasControls />
      </ReactFlow>
    </div>
  );
}

export function Canvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
