/**
 * PR-preview satellite card — the small graph node attached to the service it
 * previews by a dashed edge. Renders the PR number (mono, tabular), the
 * small-caps PREVIEW kind label, a statusMeta pill (state never encoded in
 * color alone), and the head branch in mono. Click-through opens the preview
 * URL; the node itself has no detail panel.
 */
import type { NodeProps } from "@xyflow/react";

import { HugeiconsIcon } from "@hugeicons/react";
import { Handle, Position } from "@xyflow/react";

import { cn } from "@/shared/lib/utils";

import type { ResourceFlowNode, ResourceStatus } from "./resource-node-types";

import { kindMeta, statusMeta } from "./resource-node-meta";

const badgeBase =
  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] leading-none font-medium";

/** Collapse the raw deployment status into the shared 3-state pill, or a
 *  muted textual chip for the resting states the pill model can't express. */
function pillFor(status: NonNullable<ResourceFlowNode["data"]["preview"]>["status"]): {
  kind: "status" | "muted";
  resourceStatus?: ResourceStatus;
  label: string;
} {
  switch (status) {
    case "running":
      return { kind: "status", resourceStatus: "running", label: "running" };
    case "pending":
    case "building":
      return { kind: "status", resourceStatus: "building", label: "building" };
    case "failed":
      return { kind: "status", resourceStatus: "error", label: "error" };
    case "none":
      return { kind: "muted", label: "queued" };
    default:
      return { kind: "muted", label: status };
  }
}

export function PreviewCardNode({ data, selected }: NodeProps<ResourceFlowNode>) {
  const preview = data.preview;
  if (!preview) return null;
  const pill = pillFor(preview.status);
  const meta = kindMeta.preview;

  return (
    <div
      className={cn(
        "w-64 rounded-2xl border bg-card p-3 shadow-[0_1px_2px_0_rgb(0_0_0/0.06)] transition-shadow",
        selected && "ring-2 ring-ring/40",
        "cursor-pointer",
      )}
      title="Open preview details"
    >
      <Handle type="target" position={Position.Left} className="!size-2 opacity-0" />
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-[9px] border bg-background">
          <HugeiconsIcon
            icon={meta.icon}
            strokeWidth={1.8}
            className={cn("size-4", meta.iconColor)}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[13.5px] leading-tight font-medium tabular-nums">
            #{preview.prNumber}
          </div>
          <div className="font-mono text-[10.5px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
            {meta.label}
          </div>
        </div>
        {pill.kind === "status" && pill.resourceStatus ? (
          <span className={cn(badgeBase, statusMeta[pill.resourceStatus].pillClass)}>
            <span
              className={cn("size-1.5 rounded-full", statusMeta[pill.resourceStatus].dotClass)}
            />
            {pill.label}
          </span>
        ) : (
          <span className={cn(badgeBase, "bg-muted text-muted-foreground")}>{pill.label}</span>
        )}
      </div>
      <div className="mt-2.5 truncate border-t pt-2.5 font-mono text-[12px] text-muted-foreground">
        {preview.branch}
      </div>
    </div>
  );
}
