import { useRef, useState, type ComponentProps } from "react";

import {
  CheckmarkCircle02Icon,
  Database02Icon,
  EarthIcon,
  Loading03Icon,
  PencilEdit01Icon,
  PlusSignIcon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Handle,
  NodeToolbar,
  Position,
  useReactFlow,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { toast } from "sonner";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/utils";

type IconType = ComponentProps<typeof HugeiconsIcon>["icon"];

export type ResourceKind = "service" | "database" | "route";

export type ResourceStatus = "running" | "building" | "error";

export type ResourceNodeData = {
  kind: ResourceKind;
  name: string;
  description: string;
  status?: ResourceStatus;
  tech?: { label: string; icon?: IconType };
};

export type ResourceFlowNode = Node<ResourceNodeData, "resource">;

const kindMeta: Record<
  ResourceKind,
  { label: string; icon: IconType; iconClass: string }
> = {
  service: {
    label: "Service",
    icon: ServerStack01Icon,
    iconClass:
      "bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
  },
  database: {
    label: "Database",
    icon: Database02Icon,
    iconClass:
      "bg-sky-500/15 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300",
  },
  route: {
    label: "Route",
    icon: EarthIcon,
    iconClass:
      "bg-emerald-500/15 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
  },
};

const statusMeta: Record<
  ResourceStatus,
  { label: string; dotClass: string; textClass: string }
> = {
  running: {
    label: "running",
    dotClass: "bg-success ring-2 ring-success/20",
    textClass: "text-success",
  },
  building: {
    label: "building",
    dotClass: "bg-warning ring-2 ring-warning/20",
    textClass: "text-warning",
  },
  error: {
    label: "error",
    dotClass: "bg-destructive ring-2 ring-destructive/20",
    textClass: "text-destructive",
  },
};

export function ResourceNode({
  id,
  data,
  selected,
}: NodeProps<ResourceFlowNode>) {
  const { updateNodeData } = useReactFlow<ResourceFlowNode>();
  const meta = kindMeta[data.kind];
  const status = data.status ? statusMeta[data.status] : null;

  const [isHovered, setIsHovered] = useState(false);
  const hideTimer = useRef<number | null>(null);

  function show() {
    if (hideTimer.current !== null) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setIsHovered(true);
  }

  function scheduleHide() {
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setIsHovered(false), 150);
  }

  const actions: {
    icon: IconType;
    label: string;
    description: string;
    onClick: () => void;
  }[] = [
    {
      icon: PlusSignIcon,
      label: "Connect",
      description: "Add a connection from this resource to another.",
      onClick: () =>
        toast(`Connect ${data.name}`, {
          description: "Pick a resource to connect to",
        }),
    },
    {
      icon: Loading03Icon,
      label: "Restart",
      description: "Cycle this resource and re-run its deploy.",
      onClick: () => {
        updateNodeData(id, { status: "building" });
        toast(`Restarting ${data.name}…`);
        setTimeout(() => updateNodeData(id, { status: "running" }), 1500);
      },
    },
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

  return (
    <div className="relative" onMouseEnter={show} onMouseLeave={scheduleHide}>
      <Handle
        type="target"
        position={Position.Top}
        className="size-2! border-[1.5px]! border-border! bg-card!"
      />

      <div
        className={cn(
          "w-72 overflow-hidden rounded-xl border bg-card shadow-sm transition-all",
          selected && "ring-2 ring-ring/40",
        )}
      >
        <div className="flex items-start gap-3 px-4 pt-3.5 pb-3">
          <div
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-md",
              meta.iconClass,
            )}
          >
            <HugeiconsIcon
              icon={meta.icon}
              strokeWidth={2}
              className="size-4"
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold tracking-tight text-card-foreground">
              {data.name}
            </div>
            <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
              {meta.label}
            </div>
          </div>

          {status && (
            <div
              className={cn(
                "inline-flex items-center gap-1.5 text-[11px] font-medium",
                status.textClass,
              )}
            >
              <span className={cn("size-1.5 rounded-full", status.dotClass)} />
              {status.label}
            </div>
          )}
        </div>

        <p className="px-4 pb-3.5 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
          {data.description}
        </p>

        {data.tech && (
          <div className="flex items-center justify-between gap-2 border-t bg-muted/50 px-4 py-2.5 dark:bg-muted/60">
            <div className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              {data.tech.icon && (
                <HugeiconsIcon
                  icon={data.tech.icon}
                  strokeWidth={2}
                  className="size-3"
                />
              )}
              {data.tech.label}
            </div>
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              strokeWidth={2}
              className="size-3 text-muted-foreground/60"
            />
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="size-2! border-[1.5px]! border-border! bg-card!"
      />

      <NodeToolbar
        position={Position.Right}
        offset={10}
        isVisible={selected || isHovered}
      >
        <TooltipProvider delay={200}>
          <div
            className="flex flex-col gap-0.5 rounded-full border bg-card p-1 shadow-md"
            onMouseEnter={show}
            onMouseLeave={scheduleHide}
          >
            {actions.map(({ icon, label, description, onClick }) => (
              <Tooltip key={label}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={label}
                      onClick={onClick}
                      className="grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <HugeiconsIcon
                        icon={icon}
                        strokeWidth={2}
                        className="size-3.5"
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
    </div>
  );
}
