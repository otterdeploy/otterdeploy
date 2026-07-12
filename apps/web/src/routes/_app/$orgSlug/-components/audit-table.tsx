import { Alert01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { type AuditEvent } from "@/features/audit/data/audit";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { ErrorState } from "@/shared/components/ui/error-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";
import { formatNumber } from "@otterdeploy/shared/format";

import { ActionDot, ActorChip, AuditPending, OutcomeBadge, TargetKindIcon } from "./audit-parts";
import { timeAgo } from "./audit-helpers";

/**
 * The loading / error / empty / table states for the audit list. State flags
 * come from the companion stats query; the live rows + total drive the body.
 */
export function AuditTableSection({
  items,
  total,
  isLoading,
  isError,
  isFetching,
  errorMessage,
  onRetry,
  onOpen,
  onLoadMore,
}: {
  items: AuditEvent[];
  total: number;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  errorMessage?: string;
  onRetry: () => void;
  onOpen: (event: AuditEvent) => void;
  onLoadMore: () => void;
}) {
  if (isLoading) return <AuditPending />;
  if (isError) {
    return (
      <ErrorState
        title="Couldn't load audit events"
        message={errorMessage}
        onRetry={onRetry}
      />
    );
  }
  if (!isFetching && items.length === 0) {
    return (
      <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
        <EmptyHeader>
          <HugeiconsIcon
            icon={Alert01Icon}
            strokeWidth={1.5}
            className="size-10 text-muted-foreground/50"
          />
          <EmptyTitle>No audit events</EmptyTitle>
          <EmptyDescription>
            Nothing matches these filters yet. Mutations and denials will appear
            here as they happen.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <Card className="overflow-hidden rounded-md p-0 gap-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Time</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead>IP</TableHead>
            <TableHead className="pr-4" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((e) => (
            <TableRow
              key={e.id}
              className={cn(
                "cursor-pointer",
                e.outcome !== "success" && "bg-amber-500/5",
              )}
              onClick={() => onOpen(e)}
            >
              <TableCell className="pl-4 font-mono text-[11px] text-muted-foreground">
                {timeAgo(e.timestamp)}
              </TableCell>
              <TableCell>
                <ActorChip event={e} />
              </TableCell>
              <TableCell className="font-mono text-xs">
                <span className="flex items-center gap-2">
                  <ActionDot action={e.action} />
                  {e.action}
                </span>
              </TableCell>
              <TableCell className="max-w-[220px] font-mono text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <TargetKindIcon targetType={e.targetType} />
                  <span className="truncate" title={e.targetId ?? undefined}>
                    {e.targetId ?? e.targetType ?? "—"}
                  </span>
                </span>
              </TableCell>
              <TableCell>
                <OutcomeBadge outcome={e.outcome} />
              </TableCell>
              <TableCell className="font-mono text-[11px] text-muted-foreground">
                {e.ip ?? "—"}
              </TableCell>
              <TableCell className="pr-4 text-right">
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  strokeWidth={2}
                  className="ml-auto size-3.5 text-muted-foreground/60"
                />
              </TableCell>
            </TableRow>
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
