/**
 * Shared types for the graph resource nodes. Split out of resource-node.tsx
 * (which re-exports them) so the node components + their helpers can live in
 * sibling files without a circular import.
 */

import type { HugeiconsIcon } from "@hugeicons/react";
import type { UnknownRecord } from "@otterdeploy/shared/json";
import type { Node } from "@xyflow/react";

import type { ComponentProps, SVGProps } from "react";

import type { FrameworkKind } from "@/features/projects/components/framework-logo";

export type IconType = ComponentProps<typeof HugeiconsIcon>["icon"];
export type BrandSvg = (props: SVGProps<SVGSVGElement>) => React.ReactNode;

export type ResourceKind = "service" | "database" | "volume" | "compose" | "preview";

export type ResourceEngine =
  | "postgres"
  | "mysql"
  | "mariadb"
  | "redis"
  | "mongodb"
  | "docker"
  | "clickhouse";

export type ResourceStatus = "running" | "building" | "error" | "paused" | "queued";

export interface VolumeAttachment {
  name: string;
  size: string;
  mount?: string;
}

export interface ReplicaInfo {
  /** Replica identifier: typically a swarm task slot like "1", "r1", or a
   *  short suffix. Used as the visible label. */
  label: string;
  status: ResourceStatus;
}

/**
 * Per-service state inside a compose stack. Distinct from a top-level node's
 * `ResourceStatus` because a stack service has two extra resting states the
 * single-pill model can't express: `offline` (deployed but no running task,
 * "which one is down?") and `pending` (staged, never deployed). This is the
 * whole point of rendering a stack as a group: each service answers for itself.
 */
export type StackServiceStatus = "running" | "building" | "error" | "offline" | "pending";

/** One service inside a compose stack's group card. */
export interface ComposeServiceInfo {
  name: string;
  /** Resolved image ref, or null when the service is built from source. */
  image: string | null;
  hasBuild: boolean;
  /** Named-volume sources the service mounts. Rendered as chips. */
  volumes: string[];
  /** Public host this service is reachable at, when it has one. Drives the
   *  card's Visit affordance. A running service with a domain is something
   *  the operator wants to open from the graph, not hunt for in a panel. */
  publicUrl?: string | null;
  /** This service's own runtime state. Undefined → treated as offline. */
  status?: StackServiceStatus;
  /** Real service resource id: present once the stack is deployed, so the
   *  card opens that service's full detail panel. Absent pre-first-deploy. */
  resourceId?: string;
  /** How many times this service has restarted (0/undefined → hide the badge). */
  restarts?: number;
}

export interface GitInfo {
  /** Short SHA, e.g. "a3f8b2c". */
  commit: string;
  /** Subject line of the commit (first line only). */
  message: string;
  /** Optional branch the commit lives on. */
  branch?: string;
}

/** Data for a PR-preview satellite card (kind="preview"): a small node
 *  attached to the service it previews by a dashed edge. */
export interface PreviewInfo {
  /** The preview row id: routes the satellite click to its detail panel. */
  id: string;
  prNumber: number;
  /** Plain head branch name (`feat/checkout-v2`). */
  branch: string;
  /** PR presentation metadata. Null when GitHub didn't send it, or the preview
   *  predates it being captured. The card degrades rather than hides. */
  title: string | null;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  /** Canonical PR page, for a one-click hop to GitHub. */
  prUrl: string | null;
  /** Latest preview deployment status for this service, raw from the API. */
  status:
    | "pending"
    | "building"
    | "running"
    | "failed"
    | "cancelled"
    | "superseded"
    | "removed"
    | "none"
    | "paused";
  /** Preview host URL: the card's click-through. Null until exposed. */
  url: string | null;
  /** True when the running container predates the PR's head commit. */
  stale?: boolean;
  /** Containers stopped to free resources; routes and the row are kept. */
  paused?: boolean;
  /** Keep-alive pin, exempt from idle teardown. */
  pinned?: boolean;
  /** React-Flow id of the service node this satellite hangs off
   *  (`service:<name>`): drives manual right-of-parent placement. */
  parentId: string;
}

// Extends UnknownRecord because xyflow's `Node<NodeData extends Record<string,
// unknown>>` constraint requires node data to carry a string index signature.
export interface ResourceNodeData extends UnknownRecord {
  kind: ResourceKind;
  name: string;
  description: string;
  /** Owning project id, needed by the node's inline actions (restart) to
   *  target the right oRPC mutation. */
  projectId?: string;
  /** Real resource id. The React-Flow node id is `${kind}:${name}` (stable
   *  across the staged-create ghost → applied-resource transition), so the
   *  resourceId the API needs lives here, not in the node id. Absent on ghost
   *  (pending-create) nodes, which have no resource yet. */
  resourceId?: string;
  engine?: ResourceEngine;
  /** Service/database-only: the bare DNS alias other resources on the
   *  project's overlay network reach this one at. Absent for a compose
   *  stack (no single hostname, each member has its own) and for a
   *  pending-create ghost (nothing provisioned yet). Drives the graph node
   *  context menu's "Copy internal hostname" action. */
  internalHostname?: string;
  /** Detected framework for git-sourced services (next/node/python/…).
   *  When present, the header tile renders the framework's brand SVG
   *  in place of the generic kind icon, and the tech footer prefixes
   *  the framework label. */
  framework?: FrameworkKind | null;
  /** Compose-only: SvglLogo search string from the source template. When set,
   *  the stack header renders the brand tile in place of the generic icon. */
  logoBrand?: string;
  status?: ResourceStatus;
  /** Latest deployment timestamps: the header shows the live build/deploy
   *  duration while the node is building (`finishedAt` null = still in flight). */
  latestDeploymentStartedAt?: string | null;
  latestDeploymentFinishedAt?: string | null;
  tech?: { label: string; icon?: IconType };
  /** Source-based deploys: latest deployed commit. Renders in the muted footer. */
  git?: GitInfo;
  /** Database-only: render volumes inline inside the inset MOUNTS tray (Variant A). */
  volumes?: VolumeAttachment[];
  /** Service-only: one entry per scheduled task. Renders an inset REPLICAS
   *  tray so the operator can see fan-out + per-task health at a glance. */
  replicas?: ReplicaInfo[];
  /** Service-only: recent restart count (Docker RestartCount / swarm retries).
   *  Rendered as a ↻ badge in the header when > 0. */
  restarts?: number;
  /** Compose-only: the stack's parsed services. Renders an inset SERVICES
   *  tray so the operator sees every container the stack will create. */
  services?: ComposeServiceInfo[];
  /** Pending manifest change. Set when the node represents a staged
   *  create/update/delete that hasn't been applied yet. Rendered with
   *  reduced opacity + a dashed border so it's visually distinct from
   *  an applied resource. */
  pending?: "create" | "update" | "delete";
  /** Public host for a service node, when exposed. See ComposeServiceInfo's
   *  field of the same name: a stack's members carry their own. */
  publicUrl?: string | null;
  /** Preview-only (kind="preview"): the satellite card's payload. */
  preview?: PreviewInfo;
}

export type ResourceFlowNode = Node<ResourceNodeData, "resource">;

/** Every kind a resource node's data can carry. See ResourceKind. */
const RESOURCE_NODE_KINDS: ReadonlySet<string> = new Set([
  "service",
  "database",
  "volume",
  "compose",
  "preview",
]);

/**
 * React Flow's generic handlers surface the untyped base `Node`. The graph
 * canvas only registers the `resource` node type (see nodeTypes in
 * graph-flow.tsx), so the check is a formality, but it is a REAL shape check:
 * node type plus the required `ResourceNodeData` fields.
 */
export function isResourceFlowNode(node: Node): node is ResourceFlowNode {
  return (
    node.type === "resource" &&
    typeof node.data.kind === "string" &&
    RESOURCE_NODE_KINDS.has(node.data.kind) &&
    typeof node.data.name === "string" &&
    typeof node.data.description === "string"
  );
}
