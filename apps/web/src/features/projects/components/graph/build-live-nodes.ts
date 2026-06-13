import type { Edge, Node } from "@xyflow/react";

import {
  resourceToNode,
  type ProjectResource,
} from "@/features/projects/components/graph/resource-to-node";
import type {
  ResourceNodeData,
  ResourceStatus,
} from "@/features/projects/components/graph/resource-node";

type Resource = ProjectResource;

interface Task {
  label: string;
  state: ResourceStatus;
}

type LiveNode = Node<ResourceNodeData, "resource">;

type ServiceStatus = ResourceStatus;

/** Most-concerning state wins: error > building > running. */
const rollupStatus = (tasks: Task[]): ServiceStatus =>
  tasks.some((t) => t.state === "error")
    ? "error"
    : tasks.some((t) => t.state === "building")
      ? "building"
      : "running";

/** Enrich a service node with rolled-up status + replica list from live tasks. */
const withReplicas = (node: LiveNode, tasks: Task[]): LiveNode =>
  tasks.length === 0
    ? node
    : {
        ...node,
        data: {
          ...node.data,
          status: rollupStatus(tasks),
          replicas: tasks.map((t) => ({ label: t.label, status: t.state })),
        },
      };

/** Pending manifest changes the graph should overlay onto its nodes.
 *  Keyed by `${resourceType}:${name}` so create-stubs and existing-node
 *  markers stay aligned with whatever the diff reports. */
export interface PendingByName {
  /** Set of `${resource}:${name}` pairs that should render as ghost
   *  nodes — they exist in the manifest but not yet in current state. */
  creates: Array<{ resource: "service" | "database"; name: string }>;
  /** Lookup: existing node IDs whose corresponding resource has a
   *  pending update or delete in the manifest. */
  marker: Map<string, "update" | "delete">;
}

/**
 * Turn raw resources + live task data into the full node list.
 *
 * The rollup picks the most concerning state across replicas
 * (error > building > running) so the header pill matches operator intuition —
 * one failing replica makes the whole service "error".
 *
 * `pending` overlays staged manifest changes onto the result:
 *   - creates are appended as ghost nodes with `pending: "create"`
 *   - existing nodes are tagged with `pending: "update" | "delete"`
 */
export const buildLiveNodes = (
  resources: Resource[],
  tasksByResourceId: Map<string, Task[]>,
  pending?: PendingByName,
): LiveNode[] => {
  const realNodes = resources.flatMap((r) => {
    // The framework (brand logo) already rides on base.data — resourceToNode
    // reads it straight off the stored resource record. No live lookup.
    const base = resourceToNode(r);
    const marker = pending?.marker.get(base.id);
    const baseWithExtras: LiveNode = {
      ...base,
      data: {
        ...base.data,
        ...(marker ? { pending: marker } : {}),
      },
    };
    if (baseWithExtras.data.kind !== "service") return [baseWithExtras];

    const node = withReplicas(
      baseWithExtras,
      tasksByResourceId.get(base.id) ?? [],
    );
    return [node];
  });

  if (!pending || pending.creates.length === 0) return realNodes;

  // Synthesize ghost nodes for staged creates so the graph reflects
  // operator intent, not just current state. They get a synthetic ID
  // (`pending:${resource}:${name}`) since no resourceId exists yet.
  const ghosts: LiveNode[] = pending.creates.map((c) => ({
    id: `pending:${c.resource}:${c.name}`,
    type: "resource",
    position: { x: 0, y: 0 },
    data: {
      kind: c.resource,
      name: c.name,
      description:
        c.resource === "database"
          ? "New database (pending)"
          : "New service (pending)",
      pending: "create",
    } as ResourceNodeData,
  }));
  return [...realNodes, ...ghosts];
};

/** Public routes are service metadata, not graph resources. */
export const buildRouteEdges = (_resources: Resource[]): Edge[] => [];
