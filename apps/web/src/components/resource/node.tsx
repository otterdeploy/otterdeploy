import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ApiIcon,
  CpuIcon,
  DatabaseIcon,
  DatabaseLightningIcon,
  GlobeIcon,
  HardDriveIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useMatchRoute, useParams } from "@tanstack/react-router";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { EllipsisVerticalIcon, EyeOffIcon, PaletteIcon, PencilLineIcon, Trash2Icon } from "lucide-react";

export const statusConfig = {
  online: { color: "bg-green-500", label: "Online" },
  degraded: { color: "bg-yellow-500", label: "Degraded" },
  crashed: { color: "bg-red-500", label: "Crashed" },
  unknown: { color: "bg-gray-500", label: "Unknown" },
  deploying: { color: "bg-blue-500", label: "Deploying" },
  stopped: { color: "bg-gray-500", label: "Stopped" },
} as const;

export type Status = keyof typeof statusConfig;

export type Kind = "web" | "api" | "worker" | "database" | "cache" | "volume";

export type ResourceNodeData = {
  id: string;
  name: string;
  kind: Kind;
  status: Status;
  metadata: Record<string, unknown>;
  attachments?: { id: string; kind: Kind; name: string }[];
};

export type GroupNodeData = {
  label: string;
};

type ResourceNode = Node<ResourceNodeData, "resource">;
type GroupNode = Node<GroupNodeData, "group">;

// --- Config ---

export const kindIcons = {
  web: GlobeIcon,
  api: ApiIcon,
  worker: CpuIcon,
  database: DatabaseIcon,
  cache: DatabaseLightningIcon,
  volume: HardDriveIcon,
} as const;

// --- Routing helper ---

function ResourceLink({
  kind,
  resourceId,
  children,
  className,
}: {
  kind: string;
  resourceId: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { projectId } = useParams({ strict: false });

  if (!projectId) return <>{children}</>;

  const activeProps = { "data-active": true } as const;

  if (kind === "volume") {
    return (
      <Link
        to="/projects/$projectId/volume/$volume"
        params={{ projectId, volume: resourceId }}
        className={className}
        activeProps={activeProps}
      >
        {children}
      </Link>
    );
  }

  return (
    <Link
      to="/projects/$projectId/service/$serviceId"
      params={{ projectId, serviceId: resourceId }}
      className={className}
      activeProps={activeProps}
    >
      {children}
    </Link>
  );
}

function Icon({ kind, className }: { kind: Kind; className?: string }) {
  const icon = kindIcons[kind] ?? GlobeIcon;
  return <HugeiconsIcon icon={icon} className={cn("size-4 text-muted-foreground", className)} />;
}

function Header({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex items-center gap-2 px-3 pt-3 pb-1", className)}>{children}</div>;
}

function Status({ status, className }: { status: Status; className?: string }) {
  const config = statusConfig[status] ?? statusConfig.unknown;
  return (
    <div
      className={cn("flex items-center gap-1.5 px-3 pb-3 text-xs text-muted-foreground", className)}
    >
      <span className={cn("inline-block size-2 rounded-full", config.color)} />
      {config.label}
    </div>
  );
}

function Attachment({
  id,
  kind,
  name,
  className,
}: {
  id: string;
  kind: Kind;
  name: string;
  className?: string;
}) {
  const match = useMatchRoute();
  const volumeMatch = match({ from: "/projects/$projectId/volume/$volume" });
  const serviceMatch = match({ from: "/projects/$projectId/service/$serviceId" });
  const isActive =
    (kind === "volume" && volumeMatch && "volume" in volumeMatch && volumeMatch.volume === id) ||
    (kind !== "volume" &&
      serviceMatch &&
      "serviceId" in serviceMatch &&
      serviceMatch.serviceId === id);

  return (
    <ResourceLink kind={kind} resourceId={id} className="block">
      <div
        data-active={isActive || undefined}
        className={cn(
          "flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50",
          "data-active:ring-2 data-active:ring-primary/50 data-active:bg-muted/30",
          className,
        )}
      >
        <Icon kind={kind} className="size-3.5" />
        <span className="truncate">{name}</span>
      </div>
    </ResourceLink>
  );
}

// --- Root wrapper ---

function ResourceNodeRoot({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-[180px] rounded-xl border bg-card text-card-foreground shadow-sm",
        className,
      )}
    >
      <Handle type="target" position={Position.Top} id="top" className="!invisible" />
      <Handle type="target" position={Position.Left} id="left" className="!invisible" />
      {children}
      <Handle type="source" position={Position.Right} id="right" className="!invisible" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="!invisible" />
    </div>
  );
}

// --- Compound export ---

export const ResourceNode = Object.assign(ResourceNodeRoot, {
  Icon,
  Header,
  Status,
  Attachment,
});

// --- Node components registered with React Flow ---

export function GroupNodeComponent({ data }: NodeProps<GroupNode>) {
  return (
    <div className="size-full rounded-2xl border border-white/10 bg-white/[0.03] text-left">
      <div className="flex items-center justify-between px-5 pt-3">
        <span className="text-left text-sm font-medium text-white/80">
          {data.label}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="rounded-md p-1 text-white/50 hover:bg-white/10 hover:text-white/80 transition-colors"
            onPointerDownCapture={(e) => e.stopPropagation()}
          >
            <EllipsisVerticalIcon className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={4}
            className="min-w-48"
            onPointerDownCapture={(e) => e.stopPropagation()}
            onPointerUpCapture={(e) => e.stopPropagation()}
            onClickCapture={(e) => e.stopPropagation()}
          >
            <DropdownMenuItem>
              <PencilLineIcon />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem>
              <EyeOffIcon />
              Hide contents
            </DropdownMenuItem>
            <DropdownMenuItem>
              <PaletteIcon />
              Colour
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">
              <Trash2Icon />
              Remove Group
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function ResourceNodeComponent({ id, data }: NodeProps<ResourceNode>) {
  return (
    <ResourceNode>
      {/* Top section — links to the service/resource page */}
      <ResourceLink
        kind={data.kind}
        resourceId={id}
        className={cn(
          "block min-h-20 rounded-xl  hover:shadow-[0px_0px_1px_4px] hover:ring-1 ring-card transition-all duration-300 shadow-white/20",
          "data-active:ring-2 data-active:ring-primary/50 data-active:bg-muted/30",
          {
            "border-b": !!data.attachments?.length,
          },
        )}
      >
        <ResourceNode.Header>
          <ResourceNode.Icon kind={data.kind} />
          <span className="text-sm font-medium">{data.name}</span>
        </ResourceNode.Header>
        <ResourceNode.Status status={data.status} />
      </ResourceLink>

      {/* Bottom section — each attachment links to its own route */}
      <div className="overflow-clip relative rounded-b-xl">
        {data.attachments?.map((att) => (
          <ResourceNode.Attachment key={att.id} {...att} />
        ))}
      </div>
    </ResourceNode>
  );
}
