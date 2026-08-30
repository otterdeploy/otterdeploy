/**
 * Presentational sections of the standard (non-stack) resource card: the
 * header (brand/kind tile + name + status/pending badge), the muted footer
 * (tech label + deployed commit), and the inset replicas/mounts trays. Split
 * out of resource-node.tsx to keep that file + ResourceCardNode under the
 * line caps.
 */

import { ArrowReloadHorizontalIcon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { FrameworkLogo } from "@/features/projects/components/framework-logo";
import { hasImageBrand, ServiceImageIcon } from "@/shared/components/brand/service-image-icon";
import { useLiveDuration } from "@/shared/lib/duration";
import { cn } from "@/shared/lib/utils";

import type { ReplicaInfo, ResourceNodeData, VolumeAttachment } from "./resource-node-types";

import { engineLogos, kindMeta, statusMeta } from "./resource-node-meta";
import { MountRow, PendingBadge, ReplicaRow } from "./resource-node-parts";
import { VisitPill } from "./visit-pill";

const badgeBase =
  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] leading-none font-medium";

/** A deploy in flight: which phase, how far, how long. Progress on the
 *  canvas, not three layers deep in a panel. */
function BuildProgress({
  phase,
  duration,
}: {
  phase: { label: string; fraction: number };
  duration: string | null;
}) {
  return (
    <div className="flex w-full flex-col items-end gap-1">
      <span className="font-mono text-[10.5px] text-muted-foreground tabular-nums">
        {phase.label}
        {duration ? ` · ${duration}` : ""}
      </span>
      <span aria-hidden className="block h-[3px] w-24 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full bg-warning transition-[width] duration-500"
          style={{ width: `${Math.round(phase.fraction * 100)}%` }}
        />
      </span>
    </div>
  );
}

/** The pending badge, or the status pill with its word. */
function HeaderPill({ data }: { data: ResourceNodeData }) {
  if (data.pending) return <PendingBadge pending={data.pending} />;
  const status = data.status ? statusMeta[data.status] : null;
  if (!status) return null;
  return (
    <span className={cn(badgeBase, status.pillClass)}>
      <span className={cn("size-1.5 rounded-full", status.dotClass)} />
      {data.statusLabel ?? status.label}
    </span>
  );
}

/** Right-side column of the card header: the pending or runtime status pill,
 *  then either the deploy's progress or the why ("exited 1 · 3 restarts"). */
function HeaderStatus({ data }: { data: ResourceNodeData }) {
  // Live build/deploy duration. Ticks while the node is building.
  const buildDuration = useLiveDuration(
    data.latestDeploymentStartedAt,
    data.latestDeploymentFinishedAt,
  );
  const phase =
    !data.pending && (data.status === "building" || data.status === "queued")
      ? data.buildPhase
      : undefined;
  const why = !phase && !data.pending ? data.statusWhy : undefined;

  return (
    <div className="flex max-w-[55%] flex-col items-end gap-1">
      <HeaderPill data={data} />
      {phase && (
        <BuildProgress phase={phase} duration={data.status === "building" ? buildDuration : null} />
      )}
      {why && (
        <span
          className="max-w-full truncate text-right text-[10.5px] text-muted-foreground"
          title={why}
        >
          {why}
        </span>
      )}
      {data.restarts != null && data.restarts > 0 && (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-warning/12 px-1.5 py-0.5 text-[10px] font-medium text-warning tabular-nums"
          title={`Restarted ${data.restarts} time${data.restarts === 1 ? "" : "s"}`}
        >
          <HugeiconsIcon icon={ArrowReloadHorizontalIcon} strokeWidth={2} className="size-3" />
          {data.restarts}
        </span>
      )}
    </div>
  );
}

export function ResourceCardHeader({ data }: { data: ResourceNodeData }) {
  const meta = kindMeta[data.kind];
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
          ) : hasImageBrand(data.image) ? (
            // Pulled-image services: the app's brand mark resolved from the
            // image ref, matching PanelIcon and the metrics cards.
            <ServiceImageIcon image={data.image} className="size-6" />
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

      <HeaderStatus data={data} />
    </div>
  );
}

/** Footer, muted strip with the runtime tech label and (for source-based
 *  resources) the deployed commit. Renders nothing when neither is present. */
export function ResourceCardFooter({ data }: { data: ResourceNodeData }) {
  // Visit alone is reason enough to render the footer. A pulled-image service
  // has neither a tech label nor a commit, and used to show no way in at all.
  if (!data.tech && !data.git && !data.publicUrl) return null;
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
      {data.publicUrl ? (
        <div className="flex min-w-0 items-center gap-2 pt-0.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted-foreground/80">
            {data.publicUrl}
          </span>
          <VisitPill url={data.publicUrl} />
        </div>
      ) : null}
    </div>
  );
}

const trayClass =
  "relative mx-2.5 mt-3.5 mb-2.5 rounded-[14px] border bg-background px-1.5 pt-1 pb-1";
const trayLabelClass =
  "absolute -top-[7px] left-3.5 bg-card px-1.5 font-mono text-[9.5px] leading-none font-semibold tracking-[0.22em] text-muted-foreground/60 uppercase";

/** Replicas tray: service fan-out + per-task health. Matches the MOUNTS
 *  visual so the two trays read as the same family. */
export function ReplicasTray({ replicas }: { replicas?: ReplicaInfo[] }) {
  // A single replica says nothing the status pill doesn't. Only worth a tray
  // when there's real fan-out to show (>1).
  if (!replicas || replicas.length <= 1) return null;
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

/** Mounts tray, Variant A from the design, separated from body by a hairline. */
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
