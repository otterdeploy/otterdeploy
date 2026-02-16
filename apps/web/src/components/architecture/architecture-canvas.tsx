import "@xyflow/react/dist/style.css";

import type {
  Connection,
  EdgeChange,
  OnNodeDrag,
  NodeChange,
  OnMoveEnd,
  OnNodesDelete,
  OnSelectionChangeFunc,
  ReactFlowInstance,
} from "@xyflow/react";

import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";

import { LeftToolbar } from "./left-toolbar";
import { ResourceNodeCard } from "./resource-node-card";
import { TopTabs } from "./top-tabs";
import type { ResourceEdge, ResourceNode } from "./types";

const nodeTypes = {
  resource: ResourceNodeCard,
};

type ArchitectureCanvasProps = {
  projectName: string;
  environmentName: string;
  nodes: ResourceNode[];
  edges: ResourceEdge[];
  onCreateClick: () => void;
  onNodesChange: (changes: NodeChange<ResourceNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<ResourceEdge>[]) => void;
  onConnect: (connection: Connection) => void;
  onNodesDelete: OnNodesDelete<ResourceNode>;
  onEdgesDelete: (deleted: ResourceEdge[]) => void;
  onSelectionChange: OnSelectionChangeFunc;
  onMoveEnd: OnMoveEnd;
  onNodeDragStart: OnNodeDrag<ResourceNode>;
  onNodeDragStop: OnNodeDrag<ResourceNode>;
  onInit: (instance: ReactFlowInstance<ResourceNode, ResourceEdge>) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

export function ArchitectureCanvas({
  projectName,
  environmentName,
  nodes,
  edges,
  onCreateClick,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodesDelete,
  onEdgesDelete,
  onSelectionChange,
  onMoveEnd,
  onNodeDragStart,
  onNodeDragStop,
  onInit,
  onZoomIn,
  onZoomOut,
  onFitView,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: ArchitectureCanvasProps) {
  return (
    <ReactFlowProvider>
      <div className="relative h-full w-full overflow-hidden rounded-xl border border-white/10 bg-[#0b1020]">
        <TopTabs
          projectName={projectName}
          environmentName={environmentName}
          onCreateClick={onCreateClick}
        />

        <LeftToolbar
          canUndo={canUndo}
          canRedo={canRedo}
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          onFitView={onFitView}
          onUndo={onUndo}
          onRedo={onRedo}
        />

        <ReactFlow
          className="architecture-canvas"
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          colorMode="dark"
          fitView
          fitViewOptions={{ padding: 0.2 }}
          defaultEdgeOptions={{
            type: "smoothstep",
            style: {
              strokeWidth: 1.5,
              stroke: "rgba(148, 163, 184, 0.8)",
            },
          }}
          connectionLineStyle={{
            stroke: "rgba(56, 189, 248, 0.9)",
            strokeWidth: 2,
          }}
          onInit={onInit}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          onSelectionChange={onSelectionChange}
          onMoveEnd={onMoveEnd}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          minZoom={0.2}
          maxZoom={1.8}
          deleteKeyCode={["Backspace", "Delete"]}
          attributionPosition="bottom-left"
          snapToGrid
          snapGrid={[12, 12]}
        >
          <Background
            color="rgba(148, 163, 184, 0.16)"
            gap={20}
            size={1}
            variant={BackgroundVariant.Dots}
          />
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  );
}
