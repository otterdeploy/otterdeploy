/**
 * One commit-first row of the project deployments table (status / service /
 * commit / author / duration / when) with the hover-revealed Roll back action
 * on eligible history rows. Split from `deployments-table.tsx` to keep that
 * file within budget.
 */

import type { ComponentProps } from "react";

import {
  Database02Icon,
  PackageIcon,
  RotateLeft01Icon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { DeploymentStatusBadge } from "@/features/resources/components/_shared/deployment-cards";
import { Button } from "@/shared/components/ui/button";
import { TableCell, TableRow } from "@/shared/components/ui/table";
import { formatDuration } from "@/shared/lib/duration";
import { shortImageRef } from "@/shared/lib/image-ref";

import { isRollbackEligible, type ProjectDeployment } from "../data/deployments-search";

type HugeIcon = ComponentProps<typeof HugeiconsIcon>["icon"];

const KIND_ICON: Record<ProjectDeployment["resourceKind"], HugeIcon> = {
  service: ServerStack01Icon,
  database: Database02Icon,
  compose: PackageIcon,
};

/** Compact relative time ("2m ago", "3d ago"); absolute lives in the title. */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Wall-clock ms since `iso` — impure by design (same idiom as `timeAgo`);
 *  it ticks via the parent's periodic refetch, not a per-row timer. */
function elapsedSinceMs(iso: string): number {
  return Date.now() - new Date(iso).getTime();
}

const IN_FLIGHT = new Set<ProjectDeployment["status"]>(["pending", "building", "starting"]);

function DurationCell({ d }: { d: ProjectDeployment }) {
  if (d.completedAt) {
    const ms = new Date(d.completedAt).getTime() - new Date(d.createdAt).getTime();
    return <span className="tabular-nums">{formatDuration(ms)}</span>;
  }
  if (IN_FLIGHT.has(d.status)) {
    // Still in flight — show honest elapsed time, ticking via the parent's
    // periodic refetch (a per-second timer per row isn't worth the churn).
    return <span className="tabular-nums">{formatDuration(elapsedSinceMs(d.createdAt))}…</span>;
  }
  // Settled without a recorded completion (old rows) — don't invent one.
  return <span className="text-muted-foreground/50">—</span>;
}

function CommitCell({ d }: { d: ProjectDeployment }) {
  if (d.gitSha) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 font-mono text-[12px] text-foreground/80" title={d.gitSha}>
          {d.gitSha.slice(0, 7)}
        </span>
        <span
          className="truncate text-[12.5px] text-foreground/90"
          title={d.gitCommitMessage ?? undefined}
        >
          {d.gitCommitMessage ?? (d.gitRef ? `on ${d.gitRef}` : "—")}
        </span>
      </span>
    );
  }
  // Uploaded local source (CLI deploy) — no commit, but the tarball's content
  // hash is the honest provenance.
  if (d.sourceSha) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 font-mono text-[12px] text-foreground/80" title={d.sourceSha}>
          {d.sourceSha.slice(0, 7)}
        </span>
        <span className="shrink-0 font-mono text-[10.5px] tracking-[0.12em] text-muted-foreground uppercase">
          source
        </span>
      </span>
    );
  }
  // Image-sourced (or database) deploy — the image ref is the provenance.
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate font-mono text-[12px] text-foreground/80" title={d.image}>
        {shortImageRef(d.image)}
      </span>
      <span className="shrink-0 font-mono text-[10.5px] tracking-[0.12em] text-muted-foreground uppercase">
        {d.reason}
      </span>
    </span>
  );
}

export function DeployRow({
  d,
  onOpen,
  onRollback,
}: {
  d: ProjectDeployment;
  onOpen: (d: ProjectDeployment) => void;
  onRollback: (d: ProjectDeployment) => void;
}) {
  const eligible = isRollbackEligible(d);
  return (
    <TableRow className="group cursor-pointer" onClick={() => onOpen(d)}>
      <TableCell className="pl-4">
        <DeploymentStatusBadge status={d.status} compact />
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-1.5">
          <HugeiconsIcon
            icon={KIND_ICON[d.resourceKind]}
            strokeWidth={2}
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <span className="truncate font-mono text-[12px]" title={d.resourceName}>
            {d.resourceName}
          </span>
        </span>
      </TableCell>
      <TableCell className="max-w-0">
        <CommitCell d={d} />
      </TableCell>
      <TableCell className="text-[12px] text-muted-foreground">
        <span className="truncate" title={d.gitCommitAuthor ?? undefined}>
          {d.gitCommitAuthor ?? "—"}
        </span>
      </TableCell>
      <TableCell className="text-right font-mono text-[11px] text-muted-foreground">
        <DurationCell d={d} />
      </TableCell>
      <TableCell className="text-right text-[12px] whitespace-nowrap text-muted-foreground">
        <span title={new Date(d.createdAt).toLocaleString()}>{timeAgo(d.createdAt)}</span>
      </TableCell>
      <TableCell className="w-28 pr-4 text-right">
        {eligible && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px] opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              onRollback(d);
            }}
          >
            <HugeiconsIcon icon={RotateLeft01Icon} strokeWidth={2} className="size-3" />
            Roll back
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}
