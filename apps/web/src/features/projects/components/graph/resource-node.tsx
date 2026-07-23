/**
 * Graph resource nodes — the React-Flow node renderers for a project's
 * resources. The bulk lives in sibling files (see resource-node-types/-meta/
 * -parts, resource-card-node, compose-group-node); this module is the public
 * entry: it re-exports the shared types and dispatches to the right node
 * renderer. Keeping `ResourceNode` + the types here preserves the import paths
 * every consumer already uses.
 */

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";

import type { ResourceFlowNode } from "./resource-node-types";

import { ComposeGroupNode } from "./compose-group-node";
import { PreviewCardNode } from "./preview-card-node";
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

// React Flow re-renders a node's wrapper on every position tick of a drag (and
// passes changing positionAbsoluteX/Y props), which would re-run each card's
// mutation/tooltip hooks 60×/sec on the node you're holding. These renderers
// only read id/data/selected/dragging, so memoize on exactly those: the card
// still *moves* (React Flow applies the transform to the wrapper element), it
// just stops re-rendering its contents mid-drag. A default `memo` wouldn't help
// — the position props change every frame — hence the explicit comparator.
export const ResourceNode = memo(
  function ResourceNode(props: NodeProps<ResourceFlowNode>) {
    // A compose stack is a group, not a single card — render its dedicated node.
    if (props.data.kind === "compose") return <ComposeGroupNode {...props} />;
    // A PR-preview satellite is a small card hanging off its service node.
    if (props.data.kind === "preview") return <PreviewCardNode {...props} />;
    return <ResourceCardNode {...props} />;
  },
  (a, b) =>
    a.id === b.id &&
    a.data === b.data &&
    a.selected === b.selected &&
    a.dragging === b.dragging,
);
