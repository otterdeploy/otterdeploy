/**
 * The standard resource card node — a single titled card for a service,
 * database, route, or volume (compose stacks render as a group; see
 * compose-group-node.tsx). Split out of resource-node.tsx to keep that file +
 * this component under the line caps.
 */

import { Loading03Icon, PencilEdit01Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation } from "@tanstack/react-query";
import { Handle, NodeToolbar, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import { toast } from "sonner";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import type { IconType, ResourceFlowNode, ResourceNodeData } from "./resource-node-types";

import {
  MountsTray,
  ReplicasTray,
  ResourceCardFooter,
  ResourceCardHeader,
} from "./resource-card-parts";
import { kindMeta, useToolbarHover } from "./resource-node-meta";
import { PendingComet } from "./resource-node-parts";

interface NodeAction {
  icon: IconType;
  label: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
}

/**
 * Build the floating-toolbar actions for a resource. Restart re-rolls the
 * running container — databases and services use different oRPC surfaces; both
 * take { projectId, resourceId } and the node id is the resource id. Status
 * flips to "building" optimistically; the live resource collection corrects it
 * once the new task settles.
 */
function useResourceActions(id: string, data: ResourceNodeData): NodeAction[] {
  const { updateNodeData } = useReactFlow<ResourceFlowNode>();
  const meta = kindMeta[data.kind];

  const dbRestart = useMutation({
    ...orpc.project.resource.database.postgres.restart.mutationOptions(),
    onSuccess: () =>
      toast.success(`Restarting ${data.name}…`, {
        description: "Track progress in the resource's Deployments tab.",
      }),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to restart"),
  });
  const serviceRestart = useMutation({
    ...orpc.service.restart.mutationOptions(),
    onSuccess: () =>
      toast.success(`Restarting ${data.name}…`, {
        description: "Track progress in the resource's Deployments tab.",
      }),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to restart"),
  });

  function restartResource() {
    if (!data.projectId || !data.resourceId) return;
    const args = {
      projectId: data.projectId as never,
      resourceId: data.resourceId as never,
    };
    // updateNodeData keys by the React-Flow node id (`${kind}:${name}`); the
    // mutation keys by the real resourceId from data — they're not the same.
    updateNodeData(id, { status: "building" });
    if (data.kind === "database") dbRestart.mutate(args);
    else if (data.kind === "service") serviceRestart.mutate(args);
  }

  const canRestart =
    (data.kind === "service" || data.kind === "database") && !!data.projectId && !!data.resourceId;
  const restartPending = dbRestart.isPending || serviceRestart.isPending;

  return [
    {
      icon: PlusSignIcon,
      label: "Connect",
      description: "Add a connection from this resource to another.",
      onClick: () =>
        toast(`Connect ${data.name}`, {
          description: "Pick a resource to connect to",
        }),
    },
    // Only resources backed by a container can be restarted.
    ...(canRestart
      ? [
          {
            icon: Loading03Icon,
            label: "Restart",
            description: "Cycle this resource and re-run its deploy.",
            disabled: restartPending,
            onClick: restartResource,
          },
        ]
      : []),
    {
      icon: PencilEdit01Icon,
      label: "Edit",
      description: `Open settings for this ${meta.label.toLowerCase()}.`,
      onClick: () =>
        toast(`Edit ${data.name}`, {
          description: `Open settings for this ${meta.label.toLowerCase()}`,
        }),
    },
  ];
}

function ResourceCardToolbar({
  visible,
  actions,
  onShow,
  onHide,
}: {
  visible: boolean;
  actions: NodeAction[];
  onShow: () => void;
  onHide: () => void;
}) {
  return (
    <NodeToolbar position={Position.Right} offset={16} isVisible={visible}>
      <TooltipProvider delay={200}>
        <div
          className="flex flex-col gap-0.5 rounded-full border bg-card p-1 shadow-md"
          onMouseEnter={onShow}
          onMouseLeave={onHide}
        >
          {actions.map(({ icon, label, description, onClick, disabled }) => (
            <Tooltip key={label}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={label}
                    onClick={onClick}
                    disabled={disabled}
                    className="grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                  >
                    <HugeiconsIcon
                      icon={icon}
                      strokeWidth={2}
                      className={cn("size-3.5", disabled && "animate-spin")}
                    />
                  </button>
                }
              />
              <TooltipContent side="right" sideOffset={10}>
                <div className="flex flex-col gap-0.5 text-left">
                  <div className="text-xs font-medium">{label}</div>
                  <div className="text-[10px] opacity-80">{description}</div>
                </div>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
    </NodeToolbar>
  );
}

export function ResourceCardNode({ id, data, selected, dragging }: NodeProps<ResourceFlowNode>) {
  const { isHovered, show, scheduleHide } = useToolbarHover();
  const actions = useResourceActions(id, data);

  return (
    <div className="relative" onMouseEnter={show} onMouseLeave={scheduleHide}>
      <Handle
        type="target"
        position={Position.Left}
        className="border-1.5 size-2 border-border bg-card"
      />

      <div
        className={cn(
          "w-92 overflow-hidden rounded-2xl border bg-card shadow-[0_24px_60px_-30px_rgba(0,0,0,0.45)] transition-all",
          selected && "ring-2 ring-ring/40",
          // Pending markers — visible state for staged manifest changes. Render
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

        {/* BODY — description only. Tech / commit live in the muted footer. */}
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

      <ResourceCardToolbar
        // A resource pending deletion is disabled — no action affordances. Also
        // hidden mid-drag: NodeToolbar positions off the node's measured rect,
        // which lags the dragged node and makes the pill flicker until the drag
        // settles.
        visible={(selected || isHovered) && !dragging && data.pending !== "delete"}
        actions={actions}
        onShow={show}
        onHide={scheduleHide}
      />
    </div>
  );
}
