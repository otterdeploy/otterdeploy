/**
 * PR-preview satellite card — the small graph node attached to the service it
 * previews by a dashed edge. Renders the PR number (mono, tabular), the
 * small-caps PREVIEW kind label, a statusMeta pill (state never encoded in
 * color alone), and the head branch in mono.
 *
 * Clicking the card opens the preview's detail panel. Visiting the deployed
 * preview itself is the thing people actually come here to do, so it gets its
 * own affordance rather than living one level down in the panel.
 */
import type { NodeProps } from "@xyflow/react";

import { LinkSquare02Icon } from "@hugeicons/core-free-icons";
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
    case "paused":
      return { kind: "muted", label: "paused" };
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
          {/* PR number + title: the title is what actually identifies the work,
              so it takes the wider line when GitHub gave us one. */}
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="font-mono text-[13.5px] leading-tight font-medium tabular-nums">
              #{preview.prNumber}
            </span>
            {preview.title ? (
              <span
                className="min-w-0 truncate text-[12px] text-foreground/80"
                title={preview.title}
              >
                {preview.title}
              </span>
            ) : null}
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
        {/* "running" means a container is up, not that it is running the commit
            on the PR. Say so, rather than letting green imply it. */}
        {preview.stale ? (
          <span
            className={cn(badgeBase, "bg-warning/12 text-warning")}
            title="The running container predates this PR's head commit"
          >
            outdated
          </span>
        ) : null}
      </div>
      {/* Who opened it. An avatar makes several concurrent previews scannable in
          a way a PR number never is; the login is the tooltip so the row stays
          quiet. Absent metadata simply drops the row. */}
      {preview.authorLogin ? (
        <div className="mt-2 flex items-center gap-1.5">
          {preview.authorAvatarUrl ? (
            <img
              src={preview.authorAvatarUrl}
              alt=""
              loading="lazy"
              className="size-4 shrink-0 rounded-full ring-1 ring-border"
            />
          ) : null}
          <span className="min-w-0 truncate text-[11.5px] text-muted-foreground">
            {preview.authorLogin}
          </span>
          {preview.prUrl ? (
            <a
              href={preview.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag nopan ml-auto shrink-0 text-[11.5px] text-muted-foreground hover:text-foreground hover:underline"
              title="Open the pull request on GitHub"
            >
              PR ↗
            </a>
          ) : null}
        </div>
      ) : null}
      <div className="mt-2.5 flex items-center gap-2 border-t pt-2.5">
        <span
          className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted-foreground"
          title={preview.branch}
        >
          {preview.branch}
        </span>
        {preview.url ? (
          <a
            href={preview.url}
            target="_blank"
            rel="noopener noreferrer"
            // `nodrag`/`nopan` keep React Flow from treating the click as a
            // canvas gesture; stopPropagation keeps it from also selecting the
            // node and sliding the detail panel over the tab you just opened.
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="nodrag nopan inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            title={`Open ${preview.url}`}
          >
            Visit
            <HugeiconsIcon icon={LinkSquare02Icon} strokeWidth={2} className="size-3" />
          </a>
        ) : (
          // Honest about state: a preview with no URL yet hasn't been exposed,
          // which is different from a broken link.
          <span className="shrink-0 text-[11.5px] text-muted-foreground/60">no URL yet</span>
        )}
      </div>
    </div>
  );
}
