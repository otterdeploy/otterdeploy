import type { Edge, Node } from "@xyflow/react";

export const resourceKinds = ["web", "api", "worker", "database", "cache", "volume"] as const;
export const resourceStatuses = ["online", "degraded", "crashed", "unknown", "deploying", "stopped"] as const;
export const resourceLinkTypes = ["depends_on", "network", "mounts"] as const;

export type ResourceKind = (typeof resourceKinds)[number];
export type ResourceStatus = (typeof resourceStatuses)[number];
export type ResourceLinkType = (typeof resourceLinkTypes)[number];

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
