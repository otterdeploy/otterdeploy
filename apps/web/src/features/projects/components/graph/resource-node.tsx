import {
  CheckmarkCircle02Icon,
  Database02Icon,
  EarthIcon,
  HardDriveIcon,
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
import { useRef, useState, type ComponentProps, type SVGProps } from "react";
import { toast } from "sonner";

import { Docker } from "@/shared/components/ui/svgs/docker";
import { Mariadb } from "@/shared/components/ui/svgs/mariadb";
import { Mongodb } from "@/shared/components/ui/svgs/mongodb";
import { Mysql } from "@/shared/components/ui/svgs/mysql";
import { Postgresql } from "@/shared/components/ui/svgs/postgresql";
import { Redis } from "@/shared/components/ui/svgs/redis";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/utils";

type IconType = ComponentProps<typeof HugeiconsIcon>["icon"];
type BrandSvg = (props: SVGProps<SVGSVGElement>) => React.ReactNode;

export type ResourceKind = "service" | "database" | "route" | "volume";

export type ResourceEngine = "postgres" | "mysql" | "mariadb" | "redis" | "mongodb" | "docker";

export type ResourceStatus = "running" | "building" | "error";

export interface VolumeAttachment {
  name: string;
  size: string;
  mount?: string;
}

export interface GitInfo {
  /** Short SHA, e.g. "a3f8b2c". */
  commit: string;
  /** Subject line of the commit (first line only). */
  message: string;
  /** Optional branch the commit lives on. */
  branch?: string;
}

export interface ResourceNodeData extends Record<string, unknown> {
  kind: ResourceKind;
  name: string;
  description: string;
  engine?: ResourceEngine;
  status?: ResourceStatus;
  tech?: { label: string; icon?: IconType };
  /** Source-based deploys: latest deployed commit. Renders in the muted footer. */
  git?: GitInfo;
  /** Database-only: render volumes inline inside the inset MOUNTS tray (Variant A). */
  volumes?: VolumeAttachment[];
}

/** Volume pill — matches the design spec's `.vol-pill` (Variant A, inset tray). */
function VolumePill({ volume }: { volume: VolumeAttachment }) {
  const [sizeNum, sizeUnit] = (() => {
    const parts = volume.size.trim().split(/\s+/);
    return [parts[0] ?? volume.size, parts.slice(1).join(" ")];
  })();
  return (
    <span
      className="inline-flex min-w-0 items-center gap-2 rounded-full border bg-muted py-[3px] pr-3 pl-[3px] font-mono text-[12.5px] leading-none whitespace-nowrap"
      title={`${volume.name} · ${volume.size}${volume.mount ? ` · ${volume.mount}` : ""}`}
    >
      <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-violet-500/20 text-violet-600 dark:text-violet-300">
        <HugeiconsIcon icon={HardDriveIcon} strokeWidth={1.6} className="size-3" />
      </span>
      <span className="truncate text-card-foreground">{volume.name}</span>
      <span className="text-muted-foreground/40">·</span>
      <span className="shrink-0 text-muted-foreground">
        {sizeNum}
        {sizeUnit && <span className="ml-[3px] text-muted-foreground/50">{sizeUnit}</span>}
      </span>
    </span>
  );
}

const engineLogos: Record<ResourceEngine, BrandSvg> = {
  postgres: Postgresql,
  mysql: Mysql,
  mariadb: Mariadb,
  redis: Redis,
  mongodb: Mongodb,
  docker: Docker,
};

export type ResourceFlowNode = Node<ResourceNodeData, "resource">;

const kindMeta: Record<ResourceKind, { label: string; icon: IconType; iconColor: string }> = {
  service: {
    label: "Service",
    icon: ServerStack01Icon,
    iconColor: "text-amber-700 dark:text-amber-300",
  },
  database: {
    label: "Database",
    icon: Database02Icon,
    iconColor: "text-sky-700 dark:text-sky-300",
  },
  route: {
    label: "Route",
    icon: EarthIcon,
    iconColor: "text-emerald-700 dark:text-emerald-300",
  },
  volume: {
    label: "Volume",
    icon: HardDriveIcon,
    iconColor: "text-violet-700 dark:text-violet-300",
  },
};

const statusMeta: Record<ResourceStatus, { label: string; pillClass: string; dotClass: string }> = {
  running: {
    label: "running",
    pillClass: "bg-success/12 text-success",
    dotClass: "bg-success shadow-[0_0_0_3px] shadow-success/20",
  },
  building: {
    label: "building",
    pillClass: "bg-warning/12 text-warning",
    dotClass: "bg-warning shadow-[0_0_0_3px] shadow-warning/20",
  },
  error: {
    label: "error",
    pillClass: "bg-destructive/12 text-destructive",
    dotClass: "bg-destructive shadow-[0_0_0_3px] shadow-destructive/20",
  },
};

export function ResourceNode({ id, data, selected }: NodeProps<ResourceFlowNode>) {
  const { updateNodeData } = useReactFlow<ResourceFlowNode>();
  const meta = kindMeta[data.kind];
  const status = data.status ? statusMeta[data.status] : null;
  const BrandLogo = data.engine ? engineLogos[data.engine] : null;

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
        className="border-1.5 size-2 border-border bg-card"
      />

      <div
        className={cn(
          "w-92 overflow-hidden rounded-2xl border bg-card shadow-[0_24px_60px_-30px_rgba(0,0,0,0.45)] transition-all",
          selected && "ring-2 ring-ring/40",
        )}
      >
        {/* HEADER */}
        <div className="flex items-start justify-between gap-3.5 px-5 pt-5">
          <div className="flex items-center gap-3.5">
            <div className="grid size-11 shrink-0 place-items-center rounded-[11px] border bg-background">
              {BrandLogo ? (
                <BrandLogo className="size-6" aria-label={data.engine} />
              ) : (
                <HugeiconsIcon
                  icon={meta.icon}
                  strokeWidth={1.8}
                  className={cn("size-5", meta.iconColor)}
                />
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="text-[18px] leading-[1.1] font-bold tracking-[-0.01em] break-words text-card-foreground">
                {data.name}
              </div>
              <div className="font-mono text-[10.5px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
                {meta.label}
              </div>
            </div>
          </div>

          {status && (
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] leading-none font-medium",
                status.pillClass,
              )}
            >
              <span className={cn("size-1.5 rounded-full", status.dotClass)} />
              {status.label}
            </span>
          )}
        </div>

        {/* BODY — description only. Tech / commit live in the muted footer. */}
        <div className="px-5 pt-3.5 pb-4">
          <p className="text-[13.5px] leading-[1.55] text-foreground/80">{data.description}</p>
        </div>

        {/* FOOTER — muted strip separated from the body by a hairline border.
            Houses the runtime tech label (top row) and the deployed commit
            (bottom row, source-based resources only). */}
        {(data.tech || data.git) && (
          <div className="flex flex-col gap-1.5 border-t bg-muted/50 px-5 py-3">
            {data.tech && (
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 font-mono text-[12.5px] whitespace-nowrap text-muted-foreground">
                  {data.tech.icon && (
                    <HugeiconsIcon
                      icon={data.tech.icon}
                      strokeWidth={1.5}
                      className="size-3.5 text-muted-foreground/60"
                    />
                  )}
                  {data.tech.label}
                </span>
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  strokeWidth={1.5}
                  className="size-4 text-muted-foreground/40"
                />
              </div>
            )}
            {data.git && (
              <div
                className="flex min-w-0 items-center gap-2 font-mono text-[12px] text-muted-foreground"
                title={data.git.branch ? `${data.git.branch} · ${data.git.commit}` : data.git.commit}
              >
                <span className="shrink-0 rounded bg-background/70 px-1.5 py-0.5 text-[11px] text-foreground/80">
                  {data.git.commit.slice(0, 7)}
                </span>
                <span className="truncate text-muted-foreground/90">{data.git.message}</span>
              </div>
            )}
          </div>
        )}

        {/* MOUNTS TRAY — Variant A from the design, separated from body by a hairline */}
        {data.volumes && data.volumes.length > 0 && (
          <>
            <div className="mx-5 h-px bg-border" />
            <div className="relative mx-2.5 mt-3.5 mb-2.5 rounded-[14px] border bg-background px-2.5 pt-3 pb-2.5">
              <span className="absolute -top-[7px] left-3.5 bg-card px-1.5 font-mono text-[9.5px] leading-none font-semibold tracking-[0.22em] text-muted-foreground/60 uppercase">
                Mounts
                {data.volumes.length > 1 ? ` · ${data.volumes.length}` : ""}
              </span>
              <div
                className={cn(
                  "grid gap-x-2 gap-y-1.5",
                  data.volumes.length === 1 ? "grid-cols-1" : "grid-cols-2",
                )}
              >
                {data.volumes.map((v) => (
                  <VolumePill key={v.name} volume={v} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="size-2! border-[1.5px]! border-border! bg-card!"
      />

      <NodeToolbar position={Position.Right} offset={10} isVisible={selected || isHovered}>
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
                      <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3.5" />
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
