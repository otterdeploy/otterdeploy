/**
 * Presentational sections of the standard (non-stack) resource card: the
 * header (brand/kind tile + name + status/pending badge), the muted footer
 * (tech label + deployed commit), and the inset replicas/mounts trays. Split
 * out of resource-node.tsx to keep that file + ResourceCardNode under the
 * line caps.
 */

import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { FrameworkLogo } from "@/features/projects/components/framework-logo";
import { cn } from "@/shared/lib/utils";

import type { ReplicaInfo, ResourceNodeData, VolumeAttachment } from "./resource-node-types";

import { engineLogos, kindMeta, statusMeta } from "./resource-node-meta";
import { MountRow, ReplicaRow } from "./resource-node-parts";

const badgeBase =
  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] leading-none font-medium";

/** Header — brand/framework/kind tile, name + kind label, and the pending or
 *  status pill on the right. */
export function ResourceCardHeader({ data }: { data: ResourceNodeData }) {
  const meta = kindMeta[data.kind];
  const status = data.status ? statusMeta[data.status] : null;
  const BrandLogo = data.engine ? engineLogos[data.engine] : null;
  const framework = data.framework ?? null;

  return (
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
            badgeBase,
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
        <span className={cn(badgeBase, status.pillClass)}>
          <span className={cn("size-1.5 rounded-full", status.dotClass)} />
          {status.label}
        </span>
      ) : null}
    </div>
  );
}

/** Footer — muted strip with the runtime tech label and (for source-based
 *  resources) the deployed commit. Renders nothing when neither is present. */
export function ResourceCardFooter({ data }: { data: ResourceNodeData }) {
  if (!data.tech && !data.git) return null;
  return (
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
  );
}

const trayClass =
  "relative mx-2.5 mt-3.5 mb-2.5 rounded-[14px] border bg-background px-1.5 pt-1 pb-1";
const trayLabelClass =
  "absolute -top-[7px] left-3.5 bg-card px-1.5 font-mono text-[9.5px] leading-none font-semibold tracking-[0.22em] text-muted-foreground/60 uppercase";

/** Replicas tray — service fan-out + per-task health. Matches the MOUNTS
 *  visual so the two trays read as the same family. */
export function ReplicasTray({ replicas }: { replicas?: ReplicaInfo[] }) {
  if (!replicas || replicas.length === 0) return null;
  return (
    <>
      <div className="mx-5 h-px bg-border" />
      <div className={trayClass}>
        <span className={trayLabelClass}>
          Replicas · {replicas.filter((r) => r.status === "running").length}/{replicas.length}
        </span>
        <ul className="divide-y divide-border/40">
          {replicas.map((r) => (
            <li key={r.label}>
              <ReplicaRow replica={r} />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/** Mounts tray — Variant A from the design, separated from body by a hairline. */
export function MountsTray({ volumes }: { volumes?: VolumeAttachment[] }) {
  if (!volumes || volumes.length === 0) return null;
  return (
    <>
      <div className="mx-5 h-px bg-border" />
      <div className={trayClass}>
        <span className={trayLabelClass}>
          Mounts{volumes.length > 1 ? ` · ${volumes.length}` : ""}
        </span>
        <ul className="divide-y divide-border/40">
          {volumes.map((v) => (
            <li key={v.name}>
              <MountRow volume={v} />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
