/**
 * A compose stack rendered as a GROUP: a titled container wrapping one card per
 * service, each with its own status. This is the deliberate answer to "one pill
 * for a multi-service stack is a lie" — the operator sees, at a glance, which
 * service is up, which failed to build, which is offline. Split out of
 * resource-node.tsx to keep that file + this component under the line caps.
 */

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { toast } from "sonner";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import type { ResourceFlowNode, ResourceNodeData } from "./resource-node-types";

import { kindMeta, stackRollup, stackToneClass, useToolbarHover } from "./resource-node-meta";
import { PendingComet, StackServiceCard } from "./resource-node-parts";

function ComposeGroupHeader({
  data,
  roll,
  tone,
  subline,
  hasServices,
}: {
  data: ResourceNodeData;
  roll: ReturnType<typeof stackRollup>;
  tone: { pill: string; dot: string };
  subline: string;
  hasServices: boolean;
}) {
  const meta = kindMeta.compose;
  return (
    <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-[10px] border bg-background">
          <HugeiconsIcon
            icon={meta.icon}
            strokeWidth={1.8}
            className={cn("size-5", meta.iconColor)}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="truncate text-[16px] leading-[1.1] font-bold tracking-[-0.01em] text-card-foreground">
            {data.name}
          </div>
          <div className="font-mono text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
            {subline}
          </div>
        </div>
      </div>
      {data.pending ? (
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] leading-none font-medium",
            data.pending === "delete" ? "bg-warning/15 text-warning" : "bg-info/15 text-info",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              data.pending === "delete" ? "bg-warning" : "bg-info",
            )}
          />
          pending {data.pending}
        </span>
      ) : hasServices ? (
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] leading-none font-medium",
            tone.pill,
          )}
        >
          <span className={cn("size-1.5 rounded-full", tone.dot)} />
          {roll.summary}
        </span>
      ) : null}
    </div>
  );
}

function ComposeToolbar({
  visible,
  pending,
  disabled,
  onRedeploy,
  onShow,
  onHide,
}: {
  visible: boolean;
  pending: boolean;
  disabled: boolean;
  onRedeploy: () => void;
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
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Redeploy stack"
                  disabled={disabled}
                  onClick={onRedeploy}
                  className="grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                >
                  <HugeiconsIcon
                    icon={Loading03Icon}
                    strokeWidth={2}
                    className={cn("size-3.5", pending && "animate-spin")}
                  />
                </button>
              }
            />
            <TooltipContent side="right" sideOffset={10}>
              <div className="flex flex-col gap-0.5 text-left">
                <div className="text-xs font-medium">Redeploy stack</div>
                <div className="text-[10px] opacity-80">Re-run every service in this stack.</div>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </NodeToolbar>
  );
}

export function ComposeGroupNode({ data, selected }: NodeProps<ResourceFlowNode>) {
  const services = data.services ?? [];
  const roll = stackRollup(services);
  const tone = stackToneClass[roll.tone];

  // Open a member service's full detail panel. Each stack service is a real
  // service resource, so this routes to the same panel a standalone service
  // gets (deployments/logs/terminal/variables/settings).
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as {
    orgSlug?: string;
    projectSlug?: string;
  };
  const openService = (resourceId: string) => {
    if (!params.orgSlug || !params.projectSlug) return;
    void navigate({
      to: "/$orgSlug/$projectSlug/graph/$resourceId",
      params: {
        orgSlug: params.orgSlug,
        projectSlug: params.projectSlug as never,
        resourceId,
      },
    });
  };

  const { isHovered, show, scheduleHide } = useToolbarHover();

  const redeploy = useMutation({
    ...orpc.compose.redeploy.mutationOptions(),
    onSuccess: () =>
      toast.success(`Redeploying ${data.name}…`, {
        description: "Track progress in the stack's Deployments tab.",
      }),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to redeploy"),
  });
  const onRedeploy = () => {
    if (!data.projectId || !data.resourceId) return;
    redeploy.mutate({
      projectId: data.projectId as never,
      resourceId: data.resourceId as never,
    });
  };

  const subline =
    services.length === 1 ? "Stack · 1 service" : `Stack · ${services.length} services`;

  return (
    <div className="relative" onMouseEnter={show} onMouseLeave={scheduleHide}>
      <Handle
        type="target"
        position={Position.Left}
        className="border-1.5 size-2 border-border bg-card"
      />

      <div
        className={cn(
          "w-92 overflow-hidden rounded-2xl border bg-muted/30 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.45)] transition-all",
          selected && "ring-2 ring-ring/40",
          data.pending === "delete" && "cursor-not-allowed opacity-80",
          data.pending === "update" && "border-dashed border-info/60",
        )}
      >
        <PendingComet pending={data.pending} />

        <ComposeGroupHeader
          data={data}
          roll={roll}
          tone={tone}
          subline={subline}
          hasServices={services.length > 0}
        />

        {/* CHILD SERVICE CARDS — one per compose service, independent status. */}
        <div className="flex flex-col gap-2.5 px-2.5 pb-2.5">
          {services.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-card/40 px-3.5 py-4 text-center text-[12.5px] text-muted-foreground">
              No services parsed yet
            </div>
          ) : (
            services.map((s) => <StackServiceCard key={s.name} service={s} onOpen={openService} />)
          )}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="size-2! border-[1.5px]! border-border! bg-card!"
      />

      <ComposeToolbar
        visible={(selected || isHovered) && data.pending !== "delete"}
        pending={redeploy.isPending}
        disabled={redeploy.isPending || !data.projectId || !data.resourceId}
        onRedeploy={onRedeploy}
        onShow={show}
        onHide={scheduleHide}
      />
    </div>
  );
}
