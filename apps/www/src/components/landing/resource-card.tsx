import type { ComponentType, ReactNode, SVGProps } from "react";

import { CheckmarkCircle02Icon, HardDriveIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cx } from "./primitives";

/**
 * The dashboard's resource-card node, ported for the marketing page.
 *
 * This is a presentational copy of
 * apps/web/src/features/projects/components/graph/resource-card-node.tsx and
 * its parts: same proportions, same 44px brand tile, same 18px bold name over
 * a tracked mono kind label, same muted footer with the tech line and deployed
 * commit, same status pill and comet border. The dashboard version carries
 * React Flow handles, a toolbar and live mutations; none of that belongs here,
 * so this keeps the surface and drops the behaviour.
 *
 * Keep the two in step. If the node's proportions change in the product, this
 * page is showing an old product.
 */

export type CardStatus = "running" | "building" | "queued" | "paused" | "error";

const STATUS_META: Record<CardStatus, { label: string; pill: string; dot: string }> = {
  running: {
    label: "running",
    pill: "bg-success/12 text-success",
    dot: "bg-success shadow-[0_0_0_3px] shadow-success/20",
  },
  building: {
    label: "building",
    pill: "bg-warning/12 text-warning",
    dot: "bg-warning shadow-[0_0_0_3px] shadow-warning/20",
  },
  queued: { label: "queued", pill: "bg-warning/12 text-warning", dot: "bg-warning/70" },
  paused: {
    label: "paused",
    pill: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/50",
  },
  error: {
    label: "error",
    pill: "bg-destructive/12 text-destructive",
    dot: "bg-destructive shadow-[0_0_0_3px] shadow-destructive/20",
  },
};

export interface ResourceCardProps {
  name: string;
  /** The tracked-uppercase kind label under the name: SERVICE, DATABASE, … */
  kind: string;
  status?: CardStatus;
  /** Staged manifest change. Draws the comet border, as the product does. */
  pending?: "create" | "delete";
  logo?: ComponentType<SVGProps<SVGSVGElement>>;
  description: string;
  tech?: string;
  git?: { commit: string; message: string };
  mounts?: { name: string; mount?: string; size: string }[];
  className?: string;
  style?: React.CSSProperties;
  children?: ReactNode;
}

function StatusPill({ status, pending }: { status?: CardStatus; pending?: "create" | "delete" }) {
  const base =
    "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] leading-none font-medium";
  if (pending) {
    const warn = pending === "delete";
    return (
      <span className={cx(base, warn ? "bg-warning/15 text-warning" : "bg-info/15 text-info")}>
        <span className={cx("size-1.5 rounded-full", warn ? "bg-warning" : "bg-info")} />
        pending {pending}
      </span>
    );
  }
  if (!status) return null;
  const meta = STATUS_META[status];
  return (
    <span className={cx(base, meta.pill)}>
      <span className={cx("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

export function ResourceCard({
  name,
  kind,
  status,
  pending,
  logo: Logo,
  description,
  tech,
  git,
  mounts,
  className,
  style,
}: ResourceCardProps) {
  return (
    <div
      className={cx(
        "relative overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_60px_-30px_rgba(0,0,0,0.45)]",
        className,
      )}
      style={style}
    >
      {pending ? (
        <span
          aria-hidden
          className="od-comet-border z-20 rounded-2xl"
          style={
            {
              "--comet-color": pending === "delete" ? "var(--warning)" : "var(--info)",
            } as React.CSSProperties
          }
        />
      ) : null}

      {/* Header: brand tile, name over kind label, status pill. */}
      <div className="flex items-start justify-between gap-3.5 px-5 pt-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <div className="grid size-11 shrink-0 place-items-center rounded-[11px] border border-border bg-background text-foreground">
            {Logo ? (
              <Logo className="size-6" />
            ) : (
              <span className="size-2.5 rounded-full bg-muted-foreground/40" />
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="truncate text-[18px] leading-[1.1] font-bold tracking-[-0.01em] text-card-foreground">
              {name}
            </div>
            <div className="font-mono text-[10.5px] leading-none font-medium tracking-[0.18em] text-muted-foreground uppercase">
              {kind}
            </div>
          </div>
        </div>
        <StatusPill status={status} pending={pending} />
      </div>

      <div className="px-5 pt-3.5 pb-4">
        <p className="text-[13.5px] leading-[1.55] text-foreground/80">{description}</p>
      </div>

      {tech || git ? (
        <div className="flex flex-col gap-1.5 border-t border-border bg-muted/50 px-5 py-3">
          {tech ? (
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[12.5px] whitespace-nowrap text-muted-foreground">
                {tech}
              </span>
              <HugeiconsIcon
                icon={CheckmarkCircle02Icon}
                strokeWidth={1.5}
                className="size-4 text-muted-foreground/40"
              />
            </div>
          ) : null}
          {git ? (
            <div className="flex min-w-0 items-center gap-2 font-mono text-[12px] text-muted-foreground">
              <span className="shrink-0 rounded bg-background/70 px-1.5 py-0.5 text-[11px] text-foreground/80">
                {git.commit}
              </span>
              <span className="truncate text-muted-foreground/90">{git.message}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {mounts?.length ? (
        <>
          <div className="mx-5 h-px bg-border" />
          <div className="relative mx-2.5 mt-3.5 mb-2.5 rounded-[14px] border border-border bg-background px-1.5 pt-1 pb-1">
            <span className="absolute -top-[7px] left-3.5 bg-card px-1.5 font-mono text-[9.5px] leading-none font-semibold tracking-[0.22em] text-muted-foreground/60 uppercase">
              Mounts{mounts.length > 1 ? ` · ${mounts.length}` : ""}
            </span>
            <ul className="divide-y divide-border/40">
              {mounts.map((v) => (
                <li key={v.name} className="flex items-center gap-3 px-2 py-2">
                  <span className="grid size-7 shrink-0 place-items-center rounded-md bg-violet-500/15 text-violet-600 dark:text-violet-300">
                    <HugeiconsIcon icon={HardDriveIcon} strokeWidth={1.6} className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[13px] leading-tight text-card-foreground">
                      {v.name}
                    </div>
                    {v.mount ? (
                      <div className="mt-0.5 truncate font-mono text-[11px] leading-tight text-muted-foreground/80">
                        {v.mount}
                      </div>
                    ) : null}
                  </div>
                  <span className="shrink-0 font-mono text-[12.5px] text-muted-foreground">
                    {v.size}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
