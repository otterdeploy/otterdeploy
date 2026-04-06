import { createFileRoute, Outlet } from "@tanstack/react-router";
import * as z from "zod";

import { useCallback } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import {
  EnvironmentSwitcher,
  useEnvironmentSwitcher,
  type Environment,
} from "@/features/environment-switcher";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";

import {
  DatabaseResource,
  type TDatabaseResource,
} from "@/features/project-flow/components/database-resource";

const searchParams = z.object({
  env: z.string().default("development"),
});

export const Route = createFileRoute("/_dashboard/project/$projectId")({
  validateSearch: searchParams,
  component: RouteComponent,
});

const nodeTypes: NodeTypes = {
  database: DatabaseResource,
};

const initialNodes: TDatabaseResource[] = [
  {
    id: "db-primary",
    type: "database",
    dragHandle: ".resource-drag-handle",
    position: { x: 160, y: 120 },
    data: {
      category: "Database",
      name: "primary-db",
      engine: "PostgreSQL",
      image: "postgres:16",
      volumes: [
        {
          id: "db-data:/var/lib/postgresql/data",
          source: "db-data",
          target: "/var/lib/postgresql/data",
        },
      ],
    },
  },
];
const initialEdges: Edge[] = [];

function RouteComponent() {
  const { env } = Route.useSearch();
  const navigate = Route.useNavigate();

  // Placeholder — will come from API later
  const environments: Environment[] = [
    { id: "env-dev", name: "development", label: "Development" },
    { id: "env-staging", name: "staging", label: "Staging" },
    { id: "env-prod", name: "production", label: "Production" },
  ];

  const switcher = useEnvironmentSwitcher(environments);

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params: Connection) => setEdges((edgesSnapshot) => addEdge(params, edgesSnapshot)),
    [setEdges],
  );

  useHotkey("E", () => switcher.open(env), {
    enabled: !switcher.isOpen,
  });

  useHotkey("Escape", () => switcher.close(), {
    enabled: switcher.isOpen,
  });

  useHotkey("ArrowLeft", () => switcher.prev(), {
    enabled: switcher.isOpen,
  });

  useHotkey("ArrowRight", () => switcher.next(), {
    enabled: switcher.isOpen,
  });

  useHotkey(
    "Enter",
    () => {
      const selected = switcher.select();
      if (selected) {
        navigate({ search: (prev) => ({ ...prev, env: selected.name }) });
      }
    },
    {
      enabled: switcher.isOpen,
    },
  );

  return (
    <>
      <div className="p-4 w-full h-screen">
        <ReactFlow
          className="rounded-2xl border border-border bg-background/70"
          defaultEdgeOptions={{
            style: {
              stroke: "rgba(115, 115, 130, 0.7)",
              strokeWidth: 1.5,
            },
            type: "smoothstep",
          }}
          nodes={nodes}
          nodeTypes={nodeTypes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
        >
          <Background
            id="dots"
            variant={BackgroundVariant.Dots}
            gap={8}
            color="rgba(120, 120, 140, 0.3)"
          />
        </ReactFlow>
        <Outlet />
      </div>
      <EnvironmentSwitcher
        environments={environments}
        activeIndex={switcher.activeIndex}
        isOpen={switcher.isOpen}
        onClose={switcher.close}
        onSelect={(index) => {
          const selected = environments[index];
          if (selected) {
            switcher.close();
            navigate({ search: (prev) => ({ ...prev, env: selected.name }) });
          }
        }}
        onSetIndex={(index) => switcher.setActiveIndex(index)}
      />
    </>
  );
}
