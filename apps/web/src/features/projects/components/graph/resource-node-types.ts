/**
 * Shared types for the graph resource nodes. Split out of resource-node.tsx
 * (which re-exports them) so the node components + their helpers can live in
 * sibling files without a circular import.
 */

import type { HugeiconsIcon } from "@hugeicons/react";
import type { Node } from "@xyflow/react";

import type { ComponentProps, SVGProps } from "react";

import type { FrameworkKind } from "@/features/projects/components/framework-logo";

export type IconType = ComponentProps<typeof HugeiconsIcon>["icon"];
export type BrandSvg = (props: SVGProps<SVGSVGElement>) => React.ReactNode;

export type ResourceKind = "service" | "database" | "route" | "volume" | "compose" | "preview";

export type ResourceEngine =
  | "postgres"
  | "mysql"
  | "mariadb"
  | "redis"
  | "mongodb"
  | "docker"
  | "clickhouse"
  | "rabbitmq"
  | "minio"
  | "meilisearch";

export type ResourceStatus = "running" | "building" | "error";

export interface VolumeAttachment {
  name: string;
  size: string;
  mount?: string;
}

export interface ReplicaInfo {
  /** Replica identifier — typically a swarm task slot like "1", "r1", or a
   *  short suffix. Used as the visible label. */
  label: string;
  status: ResourceStatus;
}

/**
 * Per-service state inside a compose stack. Distinct from a top-level node's
 * `ResourceStatus` because a stack service has two extra resting states the
 * single-pill model can't express: `offline` (deployed but no running task —
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
  /** Named-volume sources the service mounts — rendered as chips. */
  volumes: string[];
  /** This service's own runtime state. Undefined → treated as offline. */
  status?: StackServiceStatus;
  /** Real service resource id — present once the stack is deployed, so the
   *  card opens that service's full detail panel. Absent pre-first-deploy. */
  resourceId?: string;
}

export interface GitInfo {
  /** Short SHA, e.g. "a3f8b2c". */
  commit: string;
  /** Subject line of the commit (first line only). */
  message: string;
  /** Optional branch the commit lives on. */
  branch?: string;
}

/** Data for a PR-preview satellite card (kind="preview") — a small node
 *  attached to the service it previews by a dashed edge. */
export interface PreviewInfo {
  prNumber: number;
  /** Plain head branch name (`feat/checkout-v2`). */
  branch: string;
  /** Latest preview deployment status for this service, raw from the API. */
  status: "pending" | "building" | "running" | "failed" | "superseded" | "removed" | "none";
  /** Preview host URL — the card's click-through. Null until exposed. */
  url: string | null;
  /** React-Flow id of the service node this satellite hangs off
   *  (`service:<name>`) — drives manual right-of-parent placement. */
  parentId: string;
}

export interface ResourceNodeData extends Record<string, unknown> {
  kind: ResourceKind;
  name: string;
  description: string;
  /** Owning project id — needed by the node's inline actions (restart) to
   *  target the right oRPC mutation. */
  projectId?: string;
  /** Real resource id. The React-Flow node id is `${kind}:${name}` (stable
   *  across the staged-create ghost → applied-resource transition), so the
   *  resourceId the API needs lives here, not in the node id. Absent on ghost
   *  (pending-create) nodes, which have no resource yet. */
  resourceId?: string;
  engine?: ResourceEngine;
  /** Detected framework for git-sourced services (next/node/python/…).
   *  When present, the header tile renders the framework's brand SVG
   *  in place of the generic kind icon, and the tech footer prefixes
   *  the framework label. */
  framework?: FrameworkKind | null;
  status?: ResourceStatus;
  /** Latest deployment timestamps — the header shows the live build/deploy
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
  /** Compose-only: the stack's parsed services. Renders an inset SERVICES
   *  tray so the operator sees every container the stack will create. */
  services?: ComposeServiceInfo[];
  /** Pending manifest change — set when the node represents a staged
   *  create/update/delete that hasn't been applied yet. Rendered with
   *  reduced opacity + a dashed border so it's visually distinct from
   *  an applied resource. */
  pending?: "create" | "update" | "delete";
  /** Preview-only (kind="preview"): the satellite card's payload. */
  preview?: PreviewInfo;
}

export type ResourceFlowNode = Node<ResourceNodeData, "resource">;
