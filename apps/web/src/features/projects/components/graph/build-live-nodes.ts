import type { Edge, Node } from "@xyflow/react";

import type { FrameworkKind } from "@/features/projects/components/graph/framework-logo";
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

// Discriminated narrowing for "publicly-exposed service" — picks the service
// variant of the ProjectResource union AND asserts publicDomain is non-null.
type PublicService = Extract<Resource, { type: "service" }> & {
  publicDomain: string;
};

/** Whether this resource is a publicly-exposed service that needs a route node. */
const hasPublicRoute = (r: Resource): r is PublicService =>
  r.type === "service" && !!r.publicEnabled && !!r.publicDomain;

/** Synthetic ingress node sitting in front of a publicly-exposed service. */
const buildRouteNode = (
  r: PublicService,
  status: ResourceStatus,
): LiveNode => ({
  id: `route:${r.resourceId}`,
  type: "resource",
  position: { x: 0, y: 0 },
  data: {
    kind: "route",
    name: r.publicDomain,
    description: `Public route → ${r.name}`,
    status,
  } as ResourceNodeData,
});

/** Route → service edge so dagre ranks the route above its service. */
const buildRouteEdge = (r: PublicService): Edge => ({
  id: `route:${r.resourceId}->${r.resourceId}`,
  source: `route:${r.resourceId}`,
  target: r.resourceId,
});

// ---------- public API ----------

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
 * Turn raw resources + live task data into the full node list, including
 * synthetic route nodes that sit in front of publicly-exposed services.
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
  /** Detected framework per service resource — populated by
   *  useServiceFrameworks. Merged into service node data so the
   *  header tile can render the framework brand mark. */
  frameworksByResourceId?: Map<string, FrameworkKind>,
): LiveNode[] => {
  const realNodes = resources.flatMap((r) => {
    const base = resourceToNode(r);
    const framework = frameworksByResourceId?.get(base.id);
    const marker = pending?.marker.get(base.id);
    const baseWithExtras: LiveNode = {
      ...base,
      data: {
        ...base.data,
        ...(marker ? { pending: marker } : {}),
        ...(framework ? { framework } : {}),
      },
    };
    if (baseWithExtras.data.kind !== "service") return [baseWithExtras];

    const node = withReplicas(baseWithExtras, tasksByResourceId.get(base.id) ?? []);
    return hasPublicRoute(r)
      ? [buildRouteNode(r, node.data.status ?? "running"), node]
      : [node];
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
      description: c.resource === "database" ? "pending create" : "pending create",
      pending: "create",
    } as ResourceNodeData,
  }));
  return [...realNodes, ...ghosts];
};

/** Synthetic route → service edges for every publicly-exposed service. */
export const buildRouteEdges = (resources: Resource[]): Edge[] =>
  resources.filter(hasPublicRoute).map(buildRouteEdge);
