/**
 * Floating right-hand action pill for a resource card (Connect / Restart /
 * Edit).
 *
 * CURRENTLY UNMOUNTED: resource-card-node.tsx has its render commented out.
 * Two of the three actions only toast a placeholder ("Pick a resource to
 * connect to", "Open settings for this service"), so the pill offered a row of
 * affordances that mostly don't do anything yet. Kept whole, and split out
 * here, so switching it back on is uncommenting the one JSX block once Connect
 * and Edit are real. Restart is the only wired action.
 */

import { Loading03Icon, PencilEdit01Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation } from "@tanstack/react-query";
import { NodeToolbar, Position, useReactFlow } from "@xyflow/react";
import { toast } from "sonner";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { toastMessage } from "@/shared/lib/errors";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import type { IconType, ResourceFlowNode, ResourceNodeData } from "./resource-node-types";

import { kindMeta } from "./resource-node-meta";

interface NodeAction {
  icon: IconType;
  label: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
}

/**
 * Build the floating-toolbar actions for a resource. Restart re-rolls the
 * running container: databases and services use different oRPC surfaces; both
 * take { projectId, resourceId } and the node id is the resource id. Status
 * flips to "building" optimistically; the live resource collection corrects it
 * once the new task settles.
 */
export function useResourceActions(id: string, data: ResourceNodeData): NodeAction[] {
  const { updateNodeData } = useReactFlow<ResourceFlowNode>();
  const meta = kindMeta[data.kind];

  const dbRestart = useMutation({
    ...orpc.project.resource.database.postgres.restart.mutationOptions(),
    onSuccess: () =>
      toast.success(`Restarting ${data.name}…`, {
        description: "Track progress in the resource's Deployments tab.",
      }),
    onError: (err) => toast.error(toastMessage(err, "Failed to restart")),
  });
  const serviceRestart = useMutation({
    ...orpc.service.restart.mutationOptions(),
    onSuccess: () =>
      toast.success(`Restarting ${data.name}…`, {
        description: "Track progress in the resource's Deployments tab.",
      }),
    onError: (err) => toast.error(toastMessage(err, "Failed to restart")),
  });

  function restartResource() {
    if (!data.projectId || !data.resourceId) return;
    const args = {
      projectId: data.projectId,
      resourceId: data.resourceId,
    };
    // updateNodeData keys by the React-Flow node id (`${kind}:${name}`); the
    // mutation keys by the real resourceId from data: they're not the same.
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

export function ResourceCardToolbar({
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
