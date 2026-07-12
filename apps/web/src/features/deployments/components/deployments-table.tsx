/**
 * The project-wide deployments table — commit-first rows (status / service /
 * commit / author / duration / when) with a hover-revealed Roll back action on
 * eligible history rows (see `deployment-row.tsx`). Loading / error / empty
 * states plus the "N of M · Load more" footer follow the audit table idiom.
 */

import { RocketIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { formatNumber } from "@otterdeploy/shared/format";

import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";
import { ErrorState } from "@/shared/components/ui/error-state";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";

import type { ProjectDeployment } from "../data/deployments-search";

import { DeployRow } from "./deployment-row";

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
