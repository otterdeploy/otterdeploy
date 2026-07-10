/**
 * The project-wide deployments table — commit-first rows (status / service /
 * commit / author / duration / when) with a hover-revealed Roll back action on
 * eligible history rows. Loading / error / empty states plus the
 * "N of M · Load more" footer follow the audit table idiom.
 */

import type { ComponentProps } from "react";

import {
  Database02Icon,
  PackageIcon,
  RocketIcon,
  RotateLeft01Icon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { formatNumber } from "@otterdeploy/shared/format";

import { DeploymentStatusBadge } from "@/features/resources/components/_shared/deployment-cards";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";
import { ErrorState } from "@/shared/components/ui/error-state";
import { Skeleton } from "@/shared/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
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

const IN_FLIGHT = new Set<ProjectDeployment["status"]>(["pending", "building", "starting"]);

function DurationCell({ d }: { d: ProjectDeployment }) {
  if (d.completedAt) {
    const ms = new Date(d.completedAt).getTime() - new Date(d.createdAt).getTime();
    return <span className="tabular-nums">{formatDuration(ms)}</span>;
  }
  if (IN_FLIGHT.has(d.status)) {
    // Still in flight — show honest elapsed time, ticking via the parent's
    // periodic refetch (a per-second timer per row isn't worth the churn).
    return (
      <span className="tabular-nums">
        {formatDuration(Date.now() - new Date(d.createdAt).getTime())}…
      </span>
    );
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

function DeployRow({
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

function DeploymentsPending() {
  return (
    <Card className="gap-0 overflow-hidden rounded-md p-0">
      <div className="flex flex-col gap-3 p-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-5 w-20 rounded-sm" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-14" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function DeploymentsTableSection({
  items,
  total,
  isLoading,
  isError,
  isFetching,
  errorMessage,
  emptyVariant,
  onRetry,
  onOpen,
  onRollback,
  onLoadMore,
}: {
  items: ProjectDeployment[];
  total: number;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  errorMessage?: string;
  /** Which honest empty-state copy applies: resource/status filters are
   *  narrowing ("filters"), only the time window is ("window"), or the
   *  project genuinely has no deployments ("none"). */
  emptyVariant: "filters" | "window" | "none";
  onRetry: () => void;
  onOpen: (d: ProjectDeployment) => void;
  onRollback: (d: ProjectDeployment) => void;
  onLoadMore: () => void;
}) {
  if (isLoading) return <DeploymentsPending />;
  if (isError) {
    return (
      <ErrorState title="Couldn't load deployments" message={errorMessage} onRetry={onRetry} />
    );
  }
  if (!isFetching && items.length === 0) {
    return (
      <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
        <EmptyHeader>
          <HugeiconsIcon
            icon={RocketIcon}
            strokeWidth={1.5}
            className="size-10 text-muted-foreground/50"
          />
          <EmptyTitle>
            {emptyVariant === "filters"
              ? "Nothing matches these filters"
              : emptyVariant === "window"
                ? "No deployments in this window"
                : "No deployments yet"}
          </EmptyTitle>
          <EmptyDescription>
            {emptyVariant === "filters"
              ? "Try a wider time window or clear the resource / status filters."
              : emptyVariant === "window"
                ? "Widen the time window to see older deploys."
                : "Every build and deploy across this project lands here — push to a connected repo or deploy a resource from the graph."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <Card className="gap-0 overflow-hidden rounded-md p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24 pl-4">Status</TableHead>
            <TableHead className="w-40">Service</TableHead>
            <TableHead>Commit</TableHead>
            <TableHead className="w-32">Author</TableHead>
            <TableHead className="w-20 text-right">Duration</TableHead>
            <TableHead className="w-24 text-right">When</TableHead>
            <TableHead className="w-28 pr-4" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((d) => (
            <DeployRow key={d.id} d={d} onOpen={onOpen} onRollback={onRollback} />
          ))}
        </TableBody>
      </Table>
      {items.length < total && (
        <div className="flex items-center justify-center gap-3 border-t bg-muted/30 px-4 py-2.5 text-[12px] text-muted-foreground">
          <span>
            {formatNumber(items.length)} of {formatNumber(total)}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            disabled={isFetching}
            onClick={onLoadMore}
          >
            {isFetching ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </Card>
  );
}
