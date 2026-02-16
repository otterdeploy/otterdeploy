import type { Edge, Node } from "@xyflow/react";

export const resourceKinds = ["web", "api", "worker", "database", "cache", "volume"] as const;
export const resourceStatuses = [
  "online",
  "degraded",
  "crashed",
  "unknown",
  "deploying",
  "stopped",
] as const;
export const resourceLinkTypes = ["depends_on", "network", "mounts"] as const;

export type ResourceKind = (typeof resourceKinds)[number];
export type ResourceStatus = (typeof resourceStatuses)[number];
export type ResourceLinkType = (typeof resourceLinkTypes)[number];

function isResourceKind(value: string): value is ResourceKind {
  return resourceKinds.some((kind) => kind === value);
}

function isResourceStatus(value: string): value is ResourceStatus {
  return resourceStatuses.some((status) => status === value);
}

function isResourceLinkType(value: string): value is ResourceLinkType {
  return resourceLinkTypes.some((linkType) => linkType === value);
}

export function parseResourceKind(value: string, fallback: ResourceKind = "web"): ResourceKind {
  return isResourceKind(value) ? value : fallback;
}

export function parseResourceStatus(
  value: string,
  fallback: ResourceStatus = "unknown",
): ResourceStatus {
  return isResourceStatus(value) ? value : fallback;
}

export function parseResourceLinkType(
  value: string,
  fallback: ResourceLinkType = "network",
): ResourceLinkType {
  return isResourceLinkType(value) ? value : fallback;
}

export type ResourceNodeData = {
  name: string;
  kind: ResourceKind;
  status: ResourceStatus;
  metadata: Record<string, unknown>;
};

export type ResourceNode = Node<ResourceNodeData, "resource">;

export type ResourceEdgeData = {
  linkType: ResourceLinkType;
};

export type ResourceEdge = Edge<ResourceEdgeData, "smoothstep">;

export type ArchitectureGraphPayload = {
  project: {
    id: string;
    organizationId: string;
    ownerId: string;
    name: string;
    slug: string;
    createdAt: string;
    updatedAt: string;
  };
  environment: {
    id: string;
    projectId: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  };
  viewport: {
    x: number;
    y: number;
    zoom: number;
  };
  nodes: ResourceNode[];
  edges: ResourceEdge[];
};
