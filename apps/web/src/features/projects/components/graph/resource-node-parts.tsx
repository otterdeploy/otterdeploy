/**
 * Leaf presentational pieces for the graph resource nodes: the mount/replica
 * rows, the per-service stack card, the brand-icon picker, and the pending
 * "comet" border. Split out of resource-node.tsx to keep that file + its
 * components under the line caps.
 */

import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";

import { ArrowReloadHorizontalIcon, HardDriveIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { ServiceImageTile } from "@/shared/components/brand/service-image-icon";
import { cn } from "@/shared/lib/utils";

import type {
  ComposeServiceInfo,
  PendingMark,
  ReplicaInfo,
  VolumeAttachment,
} from "./resource-node-types";

import { pendingBadge, stackStatusMeta, statusMeta } from "./resource-node-meta";
import { VisitPill } from "./visit-pill";

/** The comet's colour is a CSS custom property, which React's CSSProperties
 *  doesn't model. Declaring the one variable we set keeps the style object
 *  typed instead of asserted. */
type CometStyle = CSSProperties & { "--comet-color": string };

/** Comet border: a light travels the edge while something is happening to a
 *  resource. Blue for a pending create, yellow for a pending delete, red while
 *  a teardown actually runs. Decorative: above content, never eats clicks. */
export function PendingComet({ pending }: { pending?: PendingMark }) {
  // Staged reads calm (blue/amber); a teardown already in flight reads
  // destructive, because it is destructive and it is happening now.
  const color =
    pending === "create"
      ? "var(--info)"
      : pending === "delete"
        ? "var(--warning)"
        : pending === "deleting"
          ? "var(--destructive)"
          : null;
  if (!color) return null;
  const style: CometStyle = { "--comet-color": color };
  return <span aria-hidden className="comet-border z-20 rounded-2xl" style={style} />;
}

/** The pending/deleting badge, shared by the resource card and the stack group
 *  header so one marker can never render two different ways. */
export function PendingBadge({ pending }: { pending: PendingMark }) {
  const badge = pendingBadge(pending);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] leading-none font-medium",
        badge.pillClass,
      )}
    >
      <span className={cn("size-1.5 rounded-full", badge.dotClass)} />
      {badge.label}
    </span>
  );
}

/** Mount row. Name + optional mount-path on the left, size aligned right.
 *  Restores the design spec's Variant A intent ("stacked rows w/ mount path"). */
export function MountRow({ volume }: { volume: VolumeAttachment }) {
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

/** Replica row: small dot + label on the left, state name on the right.
 *  Mirrors MountRow but tighter since service replicas are typically homogenous
 *  and you want to fit several per card. */
export function ReplicaRow({ replica }: { replica: ReplicaInfo }) {
  const meta = statusMeta[replica.status];
  return (
    <div
      className="flex items-center gap-2.5 px-2 py-1.5"
      title={`${replica.label} · ${meta.label}`}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", meta.dotClass)} aria-hidden />
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

/** Handlers that turn a stack service card into a button when (and only when)
 *  the service is actually deployed. Split out of StackServiceCard so the
 *  card body only ever spreads one object instead of branching on `clickable`
 *  four times over (role/tabIndex/onClick/onKeyDown). */
function stackCardActivation(
  resourceId: string | null | undefined,
  onOpen?: (resourceId: string) => void,
): {
  clickable: boolean;
  props: {
    role?: "button";
    tabIndex?: number;
    onClick?: (e: MouseEvent<HTMLDivElement>) => void;
    onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  };
} {
  if (!resourceId || !onOpen) return { clickable: false, props: {} };
  const open = () => onOpen(resourceId);
  return {
    clickable: true,
    props: {
      role: "button",
      tabIndex: 0,
      onClick: (e) => {
        // Don't let the click bubble to the stack node (which would
        // navigate to the stack instead of this service).
        e.stopPropagation();
        open();
      },
      onKeyDown: (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          open();
        }
      },
    },
  };
}

/** The status line of a stack service card: dot, state label, and the restart
 *  counter. Split out of StackServiceCard: the honest-status wording and the
 *  restart pluralisation are their own branchy concern. */
function StackServiceStatusLine({ service }: { service: ComposeServiceInfo }) {
  // `error` reads as "Build failed" only for from-source services; a pulled
  // image that won't run is a runtime error, not a build one.
  const status = stackStatusMeta[service.status ?? "offline"];
  // The member's word + why, computed once in build-live-nodes in the same
  // vocabulary the strip and the panel use; the old per-card wording is the
  // fallback for a ghost with no live data.
  const label =
    service.statusLabel ??
    (service.status === "error" && service.hasBuild ? "Build failed" : status.label);
  return (
    <div className="mt-2 flex items-center gap-2">
      <span className={cn("size-1.5 shrink-0 rounded-full", status.dotClass)} aria-hidden />
      <span className={cn("shrink-0 text-[12.5px] leading-none", status.textClass)}>{label}</span>
      {service.statusWhy && (
        <span
          className="min-w-0 truncate text-[11.5px] leading-none text-muted-foreground"
          title={service.statusWhy}
        >
          · {service.statusWhy}
        </span>
      )}
      {service.restarts != null && service.restarts > 0 && (
        <span
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/12 px-1.5 py-0.5 text-[10px] font-medium text-warning tabular-nums"
          title={`Restarted ${service.restarts} time${service.restarts === 1 ? "" : "s"}`}
        >
          <HugeiconsIcon icon={ArrowReloadHorizontalIcon} strokeWidth={2} className="size-3" />
          {service.restarts}
        </span>
      )}
    </div>
  );
}

/** Named-volume chips under a stack service card. Split out of
 *  StackServiceCard so the card body doesn't carry the empty-list branch. */
function StackVolumeChips({ volumes }: { volumes: string[] }) {
  if (volumes.length === 0) return null;
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t pt-2.5">
      {volumes.map((v) => (
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
  );
}

/** One service card inside a compose stack group: brand icon + name, an
 *  independent status line, and any named-volume chips. Each card answers for
 *  itself so a half-up stack reads honestly (one failed, one running). When the
 *  service is deployed (has a resourceId), the card opens its full panel. */
export function StackServiceCard({
  service,
  onOpen,
}: {
  service: ComposeServiceInfo;
  onOpen?: (resourceId: string) => void;
}) {
  const { clickable, props: activation } = stackCardActivation(service.resourceId, onOpen);
  return (
    <div
      // `nodrag` so interacting with the card doesn't drag the whole stack node.
      className={cn(
        "nodrag rounded-xl border bg-card px-3.5 py-3 shadow-sm transition-colors",
        // `bg-card-hover` (opaque), not `bg-muted/30`: a background-color hover
        // REPLACES the card's fill rather than layering on it, so a 4%-alpha
        // tint turned the hovered card see-through. You could read the node
        // behind it. See --card-hover in index.css.
        clickable && "cursor-pointer hover:border-ring/40 hover:bg-card-hover",
      )}
      {...activation}
    >
      <div className="flex items-center gap-2.5">
        <ServiceImageTile image={service.image} />
        <span className="min-w-0 flex-1 truncate text-[14px] leading-tight font-semibold text-card-foreground">
          {service.name}
        </span>
        {service.hasBuild && !service.image ? (
          <span className="shrink-0 rounded bg-foreground/5 px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground/80">
            build
          </span>
        ) : null}
        {/* Icon-only: the member row already carries a name, a build chip and
            a status line: the word "Visit" would push one of them off. */}
        {service.publicUrl ? <VisitPill url={service.publicUrl} compact /> : null}
      </div>
      <StackServiceStatusLine service={service} />
      <StackVolumeChips volumes={service.volumes} />
    </div>
  );
}
