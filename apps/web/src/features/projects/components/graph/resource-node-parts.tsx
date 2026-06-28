/**
 * Leaf presentational pieces for the graph resource nodes: the mount/replica
 * rows, the per-service stack card, the brand-icon picker, and the pending
 * "comet" border. Split out of resource-node.tsx to keep that file + its
 * components under the line caps.
 */

import type { CSSProperties } from "react";

import { HardDriveIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Docker } from "@/shared/components/ui/svgs/docker";
import { Mariadb } from "@/shared/components/ui/svgs/mariadb";
import { Mongodb } from "@/shared/components/ui/svgs/mongodb";
import { Mysql } from "@/shared/components/ui/svgs/mysql";
import { Postgresql } from "@/shared/components/ui/svgs/postgresql";
import { Redis } from "@/shared/components/ui/svgs/redis";
import { cn } from "@/shared/lib/utils";

import type { ComposeServiceInfo, ReplicaInfo, VolumeAttachment } from "./resource-node-types";

import { stackStatusMeta, statusMeta } from "./resource-node-meta";

/** Comet border — a light travels the edge while a resource has a staged
 *  change. Blue for a pending create (new resource), yellow for a pending
 *  delete. Decorative: sits above content but never eats clicks. */
export function PendingComet({ pending }: { pending?: "create" | "update" | "delete" }) {
  if (pending === "create") {
    return (
      <span
        aria-hidden
        className="comet-border z-20 rounded-2xl"
        style={{ "--comet-color": "var(--info)" } as CSSProperties}
      />
    );
  }
  if (pending === "delete") {
    return (
      <span
        aria-hidden
        className="comet-border z-20 rounded-2xl"
        style={{ "--comet-color": "var(--warning)" } as CSSProperties}
      />
    );
  }
  return null;
}

/** Brand SVG for a compose service from its image ref — postgres/redis/etc.
 *  get their real logo, everything else falls back to the Docker mark. */
function ServiceBrandIcon({ image, className }: { image: string | null; className?: string }) {
  if (!image) return <Docker className={className} aria-hidden />;
  // Strip registry/tag, keep the bare image name (e.g. "library/postgres:16"
  // → "postgres"). Match on substring so "bitnami/postgresql" still resolves.
  const base = image.split("/").pop()?.split(":")[0]?.toLowerCase() ?? "";
  if (base.includes("postgres")) return <Postgresql className={className} aria-hidden />;
  if (base.includes("mariadb")) return <Mariadb className={className} aria-hidden />;
  if (base.includes("mysql")) return <Mysql className={className} aria-hidden />;
  if (base.includes("mongo")) return <Mongodb className={className} aria-hidden />;
  if (base.includes("redis") || base.includes("valkey"))
    return <Redis className={className} aria-hidden />;
  return <Docker className={className} aria-hidden />;
}

/** Mount row — name + optional mount-path on the left, size aligned right.
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

/** Replica row — small dot + label on the left, state name on the right.
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

/** One service card inside a compose stack group — brand icon + name, an
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
  // `error` reads as "Build failed" only for from-source services; a pulled
  // image that won't run is a runtime error, not a build one.
  const status = stackStatusMeta[service.status ?? "offline"];
  const label = service.status === "error" && service.hasBuild ? "Build failed" : status.label;
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
          <ServiceBrandIcon image={service.image} className="size-4" />
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
        <span className={cn("truncate text-[12.5px] leading-none", status.textClass)}>{label}</span>
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
