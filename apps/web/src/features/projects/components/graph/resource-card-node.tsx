/**
 * The standard resource card node: a single titled card for a service,
 * database, route, or volume (compose stacks render as a group; see
 * compose-group-node.tsx). Split out of resource-node.tsx to keep that file +
 * this component under the line caps.
 */

import { type NodeProps, Handle, Position } from "@xyflow/react";

import { cn } from "@/shared/lib/utils";

import type { ResourceFlowNode } from "./resource-node-types";

import {
  MountsTray,
  ReplicasTray,
  ResourceCardFooter,
  ResourceCardHeader,
} from "./resource-card-parts";
import { PendingComet } from "./resource-node-parts";

export function ResourceCardNode({ data, selected }: NodeProps<ResourceFlowNode>) {
  return (
    <div className="relative">
      <Handle
        type="target"
        position={Position.Left}
        className="border-1.5 size-2 border-border bg-card"
      />

      <div
        className={cn(
          "w-84 overflow-hidden rounded-2xl border bg-card shadow-[0_24px_60px_-30px_rgba(0,0,0,0.45)] transition-all",
          selected && "ring-2 ring-ring/40",
          // Pending markers: visible state for staged manifest changes. Render
          // this on the node itself so the operator sees the diff without
          // opening the pending-changes bar. Create/delete both get the
          // animated comet border (PendingComet); delete additionally reads as
          // disabled (dimmed + not-allowed cursor).
          data.pending === "delete" && "cursor-not-allowed opacity-80",
          data.pending === "update" && "border-dashed border-info/60",
        )}
      >
        <PendingComet pending={data.pending} />

        <ResourceCardHeader data={data} />

        {/* BODY: description only. Tech / commit live in the muted footer. */}
        <div className="px-5 pt-3.5 pb-4">
          <p className="text-[13.5px] leading-[1.55] text-foreground/80">{data.description}</p>
        </div>

        <ResourceCardFooter data={data} />
        <ReplicasTray replicas={data.replicas} />
        <MountsTray volumes={data.volumes} />
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="size-2! border-[1.5px]! border-border! bg-card!"
      />

      {/* Hover/selected action pill (Connect · Restart · Edit), parked until
          Connect and Edit do something. The component and its actions hook live
          in ./resource-card-toolbar; to bring it back, restore the hover state
          + `useResourceActions(id, data)` and render:

          <ResourceCardToolbar
            visible={(selected || isHovered) && !dragging && data.pending !== "delete"}
            actions={actions}
            onShow={show}
            onHide={scheduleHide}
          />

          The wrapper above needs `onMouseEnter={show} onMouseLeave={scheduleHide}`
          back, and `id` / `dragging` come off NodeProps. */}
    </div>
  );
}
