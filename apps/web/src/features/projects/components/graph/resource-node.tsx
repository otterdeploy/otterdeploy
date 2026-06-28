/**
 * Graph resource nodes — the React-Flow node renderers for a project's
 * resources. The bulk lives in sibling files (see resource-node-types/-meta/
 * -parts, resource-card-node, compose-group-node); this module is the public
 * entry: it re-exports the shared types and dispatches to the right node
 * renderer. Keeping `ResourceNode` + the types here preserves the import paths
 * every consumer already uses.
 */

import type { NodeProps } from "@xyflow/react";

import type { ResourceFlowNode } from "./resource-node-types";

import { ComposeGroupNode } from "./compose-group-node";
import { ResourceCardNode } from "./resource-card-node";

export type {
  BrandSvg,
  ComposeServiceInfo,
  GitInfo,
  IconType,
  ReplicaInfo,
  ResourceEngine,
  ResourceFlowNode,
  ResourceKind,
  ResourceNodeData,
  ResourceStatus,
  StackServiceStatus,
  VolumeAttachment,
} from "./resource-node-types";

export function ResourceNode(props: NodeProps<ResourceFlowNode>) {
  // A compose stack is a group, not a single card — render its dedicated node.
  if (props.data.kind === "compose") return <ComposeGroupNode {...props} />;
  return <ResourceCardNode {...props} />;
}
