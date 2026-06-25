import {
  CheckmarkCircle02Icon,
  ContainerIcon,
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
import { useMutation } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type SVGProps,
} from "react";
import { toast } from "sonner";

import { orpc } from "@/shared/server/orpc";
import { Docker } from "@/shared/components/ui/svgs/docker";
import { Mariadb } from "@/shared/components/ui/svgs/mariadb";
import { Mongodb } from "@/shared/components/ui/svgs/mongodb";
import { Mysql } from "@/shared/components/ui/svgs/mysql";
import { Postgresql } from "@/shared/components/ui/svgs/postgresql";
import { Redis } from "@/shared/components/ui/svgs/redis";
import {
  FrameworkLogo,
  type FrameworkKind,
} from "@/features/projects/components/framework-logo";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/utils";

type IconType = ComponentProps<typeof HugeiconsIcon>["icon"];
type BrandSvg = (props: SVGProps<SVGSVGElement>) => React.ReactNode;

export type ResourceKind = "service" | "database" | "route" | "volume" | "compose";

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
export type StackServiceStatus =
  | "running"
  | "building"
  | "error"
  | "offline"
  | "pending";

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
}

/** Mount row — name + optional mount-path on the left, size aligned right.
 *  Restores the design spec's Variant A intent ("stacked rows w/ mount path"). */
function MountRow({ volume }: { volume: VolumeAttachment }) {
  const [sizeNum, sizeUnit] = (() => {
    const parts = volume.size.trim().split(/\s+/);
    return [parts[0] ?? volume.size, parts.slice(1).join(" ")];
  })();
  return (
    <div
      className="flex items-center gap-3 px-2 py-2"
      title={`${volume.name} · ${volume.size}${volume.mount ? ` · ${volume.mount}` : ""}`}
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-violet-500/15 text-violet-600 dark:text-violet-300">
        <HugeiconsIcon icon={HardDriveIcon} strokeWidth={1.6} className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[13px] leading-tight text-card-foreground">
          {volume.name}
        </div>
        {volume.mount && (
          <div className="mt-0.5 truncate font-mono text-[11px] leading-tight text-muted-foreground/80">
            {volume.mount}
          </div>
        )}
      </div>
      <span className="shrink-0 font-mono text-[12.5px] text-muted-foreground">
        {sizeNum}
        {sizeUnit && <span className="ml-1 text-muted-foreground/50">{sizeUnit}</span>}
      </span>
    </div>
  );
}

/** Replica row — small dot + label on the left, state name on the right.
 *  Mirrors MountRow but tighter since service replicas are typically homogenous
 *  and you want to fit several per card. */
function ReplicaRow({ replica }: { replica: ReplicaInfo }) {
  const meta = statusMeta[replica.status];
  return (
    <div
      className="flex items-center gap-2.5 px-2 py-1.5"
      title={`${replica.label} · ${meta.label}`}
    >
      <span
        className={cn("size-1.5 shrink-0 rounded-full", meta.dotClass)}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] leading-tight text-card-foreground">
        {replica.label}
      </span>
      <span
        className={cn(
          "shrink-0 font-mono text-[11px] leading-none",
          replica.status === "running"
            ? "text-muted-foreground/80"
            : replica.status === "building"
              ? "text-warning"
              : "text-destructive",
        )}
      >
        {meta.label}
      </span>
    </div>
  );
}

/** Pick a brand SVG for a compose service from its image ref — postgres/redis/
 *  etc. get their real logo, everything else falls back to the Docker mark. */
function brandForImage(image: string | null): BrandSvg {
  if (!image) return Docker;
  // Strip registry/tag, keep the bare image name (e.g. "library/postgres:16"
  // → "postgres"). Match on substring so "bitnami/postgresql" still resolves.
  const base = image.split("/").pop()?.split(":")[0]?.toLowerCase() ?? "";
  if (base.includes("postgres")) return Postgresql;
  if (base.includes("mariadb")) return Mariadb;
  if (base.includes("mysql")) return Mysql;
  if (base.includes("mongo")) return Mongodb;
  if (base.includes("redis") || base.includes("valkey")) return Redis;
  return Docker;
}

/** Per-service status → its row's label + colour. `offline`/`pending` are the
 *  states a single top-level pill can't express (see StackServiceStatus). */
const stackStatusMeta: Record<
  StackServiceStatus,
  { label: string; dotClass: string; textClass: string }
> = {
  running: {
    label: "Running",
    dotClass: "bg-success shadow-[0_0_0_3px] shadow-success/20",
    textClass: "text-success",
  },
  building: {
    label: "Building",
    dotClass: "bg-warning shadow-[0_0_0_3px] shadow-warning/20",
    textClass: "text-warning",
  },
  error: {
    label: "Failed",
    dotClass: "bg-destructive shadow-[0_0_0_3px] shadow-destructive/20",
    textClass: "text-destructive",
  },
  offline: {
    label: "Service is offline",
    dotClass: "bg-muted-foreground/40",
    textClass: "text-muted-foreground",
  },
  pending: {
    label: "Pending",
    dotClass: "bg-info shadow-[0_0_0_3px] shadow-info/20",
    textClass: "text-info",
  },
};

/** One service card inside a compose stack group — brand icon + name, an
 *  independent status line, and any named-volume chips. Each card answers for
 *  itself so a half-up stack reads honestly (one failed, one running). When the
 *  service is deployed (has a resourceId), the card opens its full panel. */
function StackServiceCard({
  service,
  onOpen,
}: {
  service: ComposeServiceInfo;
  onOpen?: (resourceId: string) => void;
}) {
  const Brand = brandForImage(service.image);
  // `error` reads as "Build failed" only for from-source services; a pulled
  // image that won't run is a runtime error, not a build one.
  const status = stackStatusMeta[service.status ?? "offline"];
  const label =
    service.status === "error" && service.hasBuild ? "Build failed" : status.label;
  const clickable = Boolean(service.resourceId && onOpen);
  return (
    <div
      // `nodrag` so interacting with the card doesn't drag the whole stack node.
      className={cn(
        "nodrag rounded-xl border bg-card px-3.5 py-3 shadow-sm transition-colors",
        clickable && "cursor-pointer hover:border-ring/40 hover:bg-muted/30",
      )}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={
        clickable
          ? (e) => {
              // Don't let the click bubble to the stack node (which would
              // navigate to the stack instead of this service).
              e.stopPropagation();
              onOpen?.(service.resourceId as string);
            }
          : undefined
      }
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onOpen?.(service.resourceId as string);
              }
            }
          : undefined
      }
    >
      <div className="flex items-center gap-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg border bg-background">
          <Brand className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px] leading-tight font-semibold text-card-foreground">
          {service.name}
        </span>
        {service.hasBuild && !service.image ? (
          <span className="shrink-0 rounded bg-foreground/5 px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground/80">
            build
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className={cn("size-1.5 shrink-0 rounded-full", status.dotClass)} aria-hidden />
        <span className={cn("truncate text-[12.5px] leading-none", status.textClass)}>
          {label}
        </span>
      </div>
      {service.volumes.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t pt-2.5">
          {service.volumes.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-1.5 py-1 font-mono text-[11px] leading-none text-muted-foreground"
              title={`Volume · ${v}`}
            >
              <HugeiconsIcon
                icon={HardDriveIcon}
                strokeWidth={1.6}
                className="size-3 text-muted-foreground/60"
              />
              {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Partial: engines without a dedicated brand logo (clickhouse, rabbitmq, minio,
// meilisearch) fall back to the generic icon at the call site (`BrandLogo ?`).
const engineLogos: Partial<Record<ResourceEngine, BrandSvg>> = {
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
  compose: {
    label: "Stack",
    icon: ContainerIcon,
    iconColor: "text-blue-700 dark:text-blue-300",
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

/**
 * Roll a stack's per-service states up to one header summary — WITHOUT
 * collapsing them. The summary says "2/3 running"; the cards below say which 2.
 * Worst-state-wins for the dot colour so a single failure colours the header.
 */
function stackRollup(services: ComposeServiceInfo[]): {
  summary: string;
  tone: "running" | "building" | "error" | "offline";
} {
  const total = services.length;
  const running = services.filter((s) => s.status === "running").length;
  const anyError = services.some((s) => s.status === "error");
  const anyBuilding = services.some(
    (s) => s.status === "building" || s.status === "pending",
  );
  if (anyError)
    return { summary: `${running}/${total} running`, tone: "error" };
  if (anyBuilding) return { summary: "Deploying…", tone: "building" };
  if (total > 0 && running === total)
    return { summary: "All running", tone: "running" };
  return { summary: `${running}/${total} running`, tone: "offline" };
}

const stackToneClass: Record<
  ReturnType<typeof stackRollup>["tone"],
  { pill: string; dot: string }
> = {
  running: { pill: "bg-success/12 text-success", dot: "bg-success" },
  building: { pill: "bg-warning/12 text-warning", dot: "bg-warning" },
  error: { pill: "bg-destructive/12 text-destructive", dot: "bg-destructive" },
  offline: {
    pill: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/50",
  },
};

/**
 * A compose stack rendered as a GROUP: a titled container wrapping one card per
 * service, each with its own status. This is the deliberate answer to "one pill
 * for a multi-service stack is a lie" — the operator sees, at a glance, which
 * service is up, which failed to build, which is offline.
 */
function ComposeGroupNode({
  data,
  selected,
}: NodeProps<ResourceFlowNode>) {
  const meta = kindMeta.compose;
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

  const redeploy = useMutation({
    ...orpc.compose.redeploy.mutationOptions(),
    onSuccess: () =>
      toast.success(`Redeploying ${data.name}…`, {
        description: "Track progress in the stack's Deployments tab.",
      }),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to redeploy"),
  });

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
        {data.pending === "create" && (
          <span
            aria-hidden
            className="comet-border z-20 rounded-2xl"
            style={{ "--comet-color": "var(--info)" } as CSSProperties}
          />
        )}
        {data.pending === "delete" && (
          <span
            aria-hidden
            className="comet-border z-20 rounded-2xl"
            style={{ "--comet-color": "var(--warning)" } as CSSProperties}
          />
        )}

        {/* GROUP HEADER */}
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
          ) : services.length > 0 ? (
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

        {/* CHILD SERVICE CARDS — one per compose service, independent status. */}
        <div className="flex flex-col gap-2.5 px-2.5 pb-2.5">
          {services.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-card/40 px-3.5 py-4 text-center text-[12.5px] text-muted-foreground">
              No services parsed yet
            </div>
          ) : (
            services.map((s) => (
              <StackServiceCard key={s.name} service={s} onOpen={openService} />
            ))
          )}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="size-2! border-[1.5px]! border-border! bg-card!"
      />

      <NodeToolbar
        position={Position.Right}
        offset={16}
        isVisible={(selected || isHovered) && data.pending !== "delete"}
      >
        <TooltipProvider delay={200}>
          <div
            className="flex flex-col gap-0.5 rounded-full border bg-card p-1 shadow-md"
            onMouseEnter={show}
            onMouseLeave={scheduleHide}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="Redeploy stack"
                    disabled={redeploy.isPending || !data.projectId || !data.resourceId}
                    onClick={() => {
                      if (!data.projectId || !data.resourceId) return;
                      redeploy.mutate({
                        projectId: data.projectId as never,
                        resourceId: data.resourceId as never,
                      });
                    }}
                    className="grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                  >
                    <HugeiconsIcon
                      icon={Loading03Icon}
                      strokeWidth={2}
                      className={cn("size-3.5", redeploy.isPending && "animate-spin")}
                    />
                  </button>
                }
              />
              <TooltipContent side="right" sideOffset={10}>
                <div className="flex flex-col gap-0.5 text-left">
                  <div className="text-xs font-medium">Redeploy stack</div>
                  <div className="text-[10px] opacity-80">
                    Re-run every service in this stack.
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </NodeToolbar>
    </div>
  );
}

export function ResourceNode(props: NodeProps<ResourceFlowNode>) {
  // A compose stack is a group, not a single card — render its dedicated node.
  if (props.data.kind === "compose") return <ComposeGroupNode {...props} />;
  return <ResourceCardNode {...props} />;
}

function ResourceCardNode({
  id,
  data,
  selected,
  dragging,
}: NodeProps<ResourceFlowNode>) {
  const { updateNodeData } = useReactFlow<ResourceFlowNode>();
  const meta = kindMeta[data.kind];
  const status = data.status ? statusMeta[data.status] : null;
  const BrandLogo = data.engine ? engineLogos[data.engine] : null;
  const framework = data.framework ?? null;

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

  // Restart re-rolls the running container. Databases and services use
  // different oRPC surfaces; both take { projectId, resourceId } and the node
  // id is the resource id. Status flips to "building" optimistically — the
  // live resource collection corrects it once the new task settles.
  const dbRestart = useMutation({
    ...orpc.project.resource.database.postgres.restart.mutationOptions(),
    onSuccess: () =>
      toast.success(`Restarting ${data.name}…`, {
        description: "Track progress in the resource's Deployments tab.",
      }),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to restart"),
  });
  const serviceRestart = useMutation({
    ...orpc.service.restart.mutationOptions(),
    onSuccess: () =>
      toast.success(`Restarting ${data.name}…`, {
        description: "Track progress in the resource's Deployments tab.",
      }),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to restart"),
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
    (data.kind === "service" || data.kind === "database") &&
    !!data.projectId &&
    !!data.resourceId;
  const restartPending = dbRestart.isPending || serviceRestart.isPending;

  const actions: {
    icon: IconType;
    label: string;
    description: string;
    disabled?: boolean;
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
          // Pending markers — visible state for staged manifest changes.
          // Render this on the node itself so the operator sees the diff
          // without opening the pending-changes bar. Create/delete both get the
          // animated comet border (below); delete additionally reads as
          // disabled (dimmed + not-allowed cursor).
          data.pending === "delete" && "cursor-not-allowed opacity-80",
          data.pending === "update" && "border-dashed border-info/60",
        )}
      >
        {/* Comet border — a light travels the edge while this resource has a
            staged change. Blue for a pending create (new resource), yellow for
            a pending delete. Decorative: sits above content but never eats
            clicks (delete nodes are already click-disabled in onNodeClick). */}
        {data.pending === "create" && (
          <span
            aria-hidden
            className="comet-border z-20 rounded-2xl"
            style={{ "--comet-color": "var(--info)" } as CSSProperties}
          />
        )}
        {data.pending === "delete" && (
          <span
            aria-hidden
            className="comet-border z-20 rounded-2xl"
            style={{ "--comet-color": "var(--warning)" } as CSSProperties}
          />
        )}
        {/* HEADER */}
        <div className="flex items-start justify-between gap-3.5 px-5 pt-5">
          <div className="flex items-center gap-3.5">
            <div className="grid size-11 shrink-0 place-items-center rounded-[11px] border bg-background">
              {framework ? (
                <FrameworkLogo framework={framework} className="size-6" />
              ) : BrandLogo ? (
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

          {data.pending ? (
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] leading-none font-medium",
                // Match the node's comet border: create = blue, delete = yellow.
                data.pending === "create" && "bg-info/15 text-info",
                data.pending === "delete" && "bg-warning/15 text-warning",
                data.pending === "update" && "bg-info/15 text-info",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  data.pending === "create" && "bg-info",
                  data.pending === "delete" && "bg-warning",
                  data.pending === "update" && "bg-info",
                )}
              />
              pending {data.pending}
            </span>
          ) : status ? (
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] leading-none font-medium",
                status.pillClass,
              )}
            >
              <span className={cn("size-1.5 rounded-full", status.dotClass)} />
              {status.label}
            </span>
          ) : null}
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

        {/* REPLICAS TRAY — service fan-out + per-task health. Matches the
            MOUNTS visual so the two trays read as the same family. */}
        {data.replicas && data.replicas.length > 0 && (
          <>
            <div className="mx-5 h-px bg-border" />
            <div className="relative mx-2.5 mt-3.5 mb-2.5 rounded-[14px] border bg-background px-1.5 pt-1 pb-1">
              <span className="absolute -top-[7px] left-3.5 bg-card px-1.5 font-mono text-[9.5px] leading-none font-semibold tracking-[0.22em] text-muted-foreground/60 uppercase">
                Replicas · {data.replicas.filter((r) => r.status === "running").length}
                /{data.replicas.length}
              </span>
              <ul className="divide-y divide-border/40">
                {data.replicas.map((r) => (
                  <li key={r.label}>
                    <ReplicaRow replica={r} />
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        {/* MOUNTS TRAY — Variant A from the design, separated from body by a hairline */}
        {data.volumes && data.volumes.length > 0 && (
          <>
            <div className="mx-5 h-px bg-border" />
            <div className="relative mx-2.5 mt-3.5 mb-2.5 rounded-[14px] border bg-background px-1.5 pt-1 pb-1">
              <span className="absolute -top-[7px] left-3.5 bg-card px-1.5 font-mono text-[9.5px] leading-none font-semibold tracking-[0.22em] text-muted-foreground/60 uppercase">
                Mounts
                {data.volumes.length > 1 ? ` · ${data.volumes.length}` : ""}
              </span>
              <ul className="divide-y divide-border/40">
                {data.volumes.map((v) => (
                  <li key={v.name}>
                    <MountRow volume={v} />
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="size-2! border-[1.5px]! border-border! bg-card!"
      />

      <NodeToolbar
        position={Position.Right}
        offset={16}
        // A resource pending deletion is disabled — no action affordances.
        // Also hidden mid-drag: NodeToolbar positions off the node's measured
        // rect, which lags the dragged node and makes the pill flicker (often
        // snapping to the wrong side) until the drag settles.
        isVisible={
          (selected || isHovered) && !dragging && data.pending !== "delete"
        }
      >
        <TooltipProvider delay={200}>
          <div
            className="flex flex-col gap-0.5 rounded-full border bg-card p-1 shadow-md"
            onMouseEnter={show}
            onMouseLeave={scheduleHide}
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
    </div>
  );
}
