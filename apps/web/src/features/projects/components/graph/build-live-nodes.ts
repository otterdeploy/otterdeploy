import type { Edge, Node } from "@xyflow/react";

import {
  resourceToNode,
  type ProjectResource,
} from "@/features/projects/components/graph/resource-to-node";
import type {
  ComposeServiceInfo,
  ResourceNodeData,
  ResourceStatus,
  StackServiceStatus,
} from "@/features/projects/components/graph/resource-node";

type Resource = ProjectResource;
type ServiceResource = Extract<Resource, { type: "service" }>;

interface Task {
  label: string;
  /** Compose sub-service this task belongs to; null for a plain service. */
  service: string | null;
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

/** Status of a single stack-member service resource — its live-task rollup if
 *  it has tasks, else its build-time deployment state. "offline" is a deployed
 *  service with no running task (the exact failure a single stack pill hides). */
const childServiceStatus = (
  child: ServiceResource,
  tasks: Task[],
): StackServiceStatus => {
  if (tasks.length > 0) return rollupStatus(tasks) as StackServiceStatus;
  switch (child.latestDeploymentStatus) {
    case "building":
    case "pending":
      return "building";
    case "failed":
      return "error";
    case "running":
      // Deployed, but no live task right now → down.
      return "offline";
    default:
      return child.latestDeploymentStatus == null ? "pending" : "offline";
  }
};

/** Roll a compose stack's tasks up PER SERVICE, so each service card shows its
 *  own state. A service with no live task while the stack is up reads "offline"
 *  (that's the failure mode a single stack pill hides). Build-time states from
 *  the base node (building/error/pending) are kept when no task exists yet. */
const withStackStatus = (node: LiveNode, tasks: Task[]): LiveNode => {
  const services = node.data.services;
  if (!services || services.length === 0) return node;

  const byService = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.service) continue;
    const arr = byService.get(t.service);
    if (arr) arr.push(t);
    else byService.set(t.service, [t]);
  }

  return {
    ...node,
    data: {
      ...node.data,
      services: services.map((s) => {
        const own = byService.get(s.name);
        const status: StackServiceStatus =
          own && own.length > 0
            ? // error > building > running, scoped to this service's tasks.
              (rollupStatus(own) as StackServiceStatus)
            : // No task: keep a build-time base (building/error/pending), else
              // the stack is up but this one isn't → offline.
              (s.status ?? "offline");
        return { ...s, status };
      }),
    },
  };
};

/** Pending manifest changes the graph should overlay onto its nodes.
 *  Keyed by `${resourceType}:${name}` so create-stubs and existing-node
 *  markers stay aligned with whatever the diff reports. */
export interface PendingByName {
  /** Set of `${resource}:${name}` pairs that should render as ghost
   *  nodes — they exist in the manifest but not yet in current state.
   *  Compose creates carry the parsed service summary so the ghost group
   *  node can render its member cards before the stack is deployed. */
  creates: Array<{
    resource: "service" | "database" | "compose";
    name: string;
    services?: ComposeServiceInfo[];
  }>;
  /** Lookup keyed by `${resource}:${name}` (the node id) → pending
   *  update/delete marker for an already-applied resource. */
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
  // A compose stack's services are now REAL service resources (stackId set).
  // They render INSIDE the stack's group, not as standalone nodes — so group
  // them by stack and drop them from the top-level list.
  const stackChildren = new Map<string, ServiceResource[]>();
  for (const r of resources) {
    if (r.type === "service" && r.stackId) {
      const arr = stackChildren.get(r.stackId);
      if (arr) arr.push(r);
      else stackChildren.set(r.stackId, [r]);
    }
  }
  const topLevel = resources.filter(
    (r) => !(r.type === "service" && r.stackId),
  );

  const realNodes = topLevel.flatMap((r) => {
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
    // Live tasks are keyed by the real resourceId (the node id is
    // `${kind}:${name}`, which is NOT the task map's key).
    const tasks = tasksByResourceId.get(r.resourceId) ?? [];

    if (r.type === "service") {
      return [withReplicas(baseWithExtras, tasks)];
    }
    if (r.type === "compose") {
      const children = stackChildren.get(r.resourceId) ?? [];
      // Before the first deploy there are no child resources yet — fall back to
      // the file summary (cards without a resourceId to click into).
      if (children.length === 0) return [withStackStatus(baseWithExtras, tasks)];
      // Volumes only live on the file summary; match by compose service name.
      const volumesByName = new Map(
        r.services.map((s) => [s.name, s.volumes] as const),
      );
      const services: ComposeServiceInfo[] = children.map((c) => ({
        name: c.name,
        image: c.image,
        hasBuild: c.source === "git",
        volumes: volumesByName.get(c.name) ?? [],
        // Real resource id → the card opens that service's full panel.
        resourceId: c.resourceId,
        status: childServiceStatus(c, tasksByResourceId.get(c.resourceId) ?? []),
      }));
      return [
        { ...baseWithExtras, data: { ...baseWithExtras.data, services } },
      ];
    }
    return [baseWithExtras];
  });

  if (!pending || pending.creates.length === 0) return realNodes;

  // Synthesize ghost nodes for staged creates so the graph reflects
  // operator intent, not just current state. The ghost shares the SAME id
  // its applied counterpart will get (`${resource}:${name}`) so that when
  // Apply lands the real resource, React Flow updates the node in place
  // instead of unmounting the ghost and mounting a resourceId-keyed node —
  // the swap that made nodes vanish and reappear. No resourceId in data yet.
  const ghosts: LiveNode[] = pending.creates.map((c) => ({
    id: `${c.resource}:${c.name}`,
    type: "resource",
    position: { x: 0, y: 0 },
    data: {
      kind: c.resource,
      name: c.name,
      description:
        c.resource === "database"
          ? "New database (pending)"
          : c.resource === "compose"
            ? "New stack (pending)"
            : "New service (pending)",
      pending: "create",
      // A compose ghost renders as a group: hand it the parsed member cards so
      // the operator sees the stack's services before deploying it.
      ...(c.resource === "compose" ? { services: c.services ?? [] } : {}),
    } as ResourceNodeData,
  }));
  return [...realNodes, ...ghosts];
};

/** Public routes are service metadata, not graph resources. */
export const buildRouteEdges = (_resources: Resource[]): Edge[] => [];
