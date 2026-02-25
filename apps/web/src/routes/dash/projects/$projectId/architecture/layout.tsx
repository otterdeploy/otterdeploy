import { ViewportController } from "@/components/project/viewport-controller";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Background, Controls, ReactFlow } from "@xyflow/react";
import { AnimatePresence, motion } from "motion/react";

import { ResourceNodeComponent, GroupNodeComponent, type Kind } from "@/components/resource/node";
export const Route = createFileRoute("/dash/projects/$projectId/architecture")({
  component: RouteComponent,
});

const nodeTypes = {
  resource: ResourceNodeComponent,
  group: GroupNodeComponent,
};

const nodes = [];
const graphEdges = [];
const onNodesChange = () => {};
const onConnect = () => {};

function RouteComponent() {
  const showChild = false;
  return (
    <>
      <div className="absolute inset-0">
        <ReactFlow
          nodes={nodes}
          edges={graphEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          colorMode="dark"
          fitView
          style={{ width: "100%", height: "100%" }}
        >
          <Controls />
          <Background />
          <ViewportController />
        </ReactFlow>
      </div>

      <AnimatePresence initial={false}>
        {showChild && (
          <motion.div
            key="child-panel"
            className="border-white/10 border-l-1 bg-background border-t-1 overflow-hidden h-[90vh] w-[60vw] max-md:w-full absolute right-0 bottom-0 rounded-tl-xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.25 }}
          >
            <Outlet />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
