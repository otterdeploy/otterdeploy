import type { Node, Edge } from "@xyflow/react";

export type CanvasNodeKind = "group" | "service" | "database" | "volume" | "routing";

export interface GroupNodeData {
  kind: "group";
  label: string;
}

export interface ServiceNodeData {
  kind: "service";
  name: string;
  source:
    | { type: "image"; image: string }
    | { type: "github"; repo: string; branch: string };
  status: "running" | "starting" | "stopped" | "missing" | "error";
  publicHostname: string | null;
}

export interface DatabaseNodeData {
  kind: "database";
  resourceId: string;
  name: string;
  engine: "postgres";
  status: "running" | "starting" | "stopped" | "missing" | "error";
  health: "healthy" | "unhealthy" | "starting" | null;
  publicHostname: string;
  internalHostname: string;
  volumeName: string;
}

export interface VolumeNodeData {
  kind: "volume";
  source: string;
  target: string;
}

export interface RoutingNodeData {
  kind: "routing";
  domains: ReadonlyArray<{ domain: string; type: "http" | "layer4" }>;
}

export type CanvasNodeData =
  | GroupNodeData
  | ServiceNodeData
  | DatabaseNodeData
  | VolumeNodeData
  | RoutingNodeData;

export type GroupNode = Node<GroupNodeData, "group">;
export type ServiceNode = Node<ServiceNodeData, "service">;
export type DatabaseNode = Node<DatabaseNodeData, "database">;
export type VolumeNode = Node<VolumeNodeData, "volume">;
export type RoutingNode = Node<RoutingNodeData, "routing">;

export type CanvasNode = GroupNode | ServiceNode | DatabaseNode | VolumeNode | RoutingNode;

export type CanvasEdge = Edge;

/** Selection state managed by the drawer hook. */
export type SelectedResource =
  | { kind: "database"; resourceId: string }
  | { kind: "service"; serviceId: string }
  | null;
