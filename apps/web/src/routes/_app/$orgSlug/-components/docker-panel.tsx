import { ContainerIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import { Badge } from "@/shared/components/ui/badge";
import { Card } from "@/shared/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/shared/components/ui/pagination";
import { ErrorState } from "@/shared/components/ui/error-state";
import { Skeleton } from "@/shared/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";

import { type StateTone } from "./docker-format";

export interface QueryLike<T> {
  data?: T[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

const PAGE_SIZE = 10;

export function Panel<T>({
  query,
  headers,
  emptyTitle,
  emptyText,
  children,
}: {
  query: QueryLike<T>;
  headers: string[];
  emptyTitle: string;
  emptyText: string;
  children: (rows: T[]) => React.ReactNode;
}) {
  // Page state lives here so each tab (Panel remounts per tab) starts at
  // page 1. Polling refetches can shrink the list, so the render clamps the
  // index into range rather than tracking total separately.
  const [page, setPage] = useState(0);

  if (query.isLoading) return <PanelSkeleton cols={headers.length} />;
  if (query.isError) {
    return (
      <ErrorState
        title="Couldn't reach the Docker daemon"
        message={(query.error as Error | null)?.message}
        onRetry={() => query.refetch()}
      />
    );
  }
  const rows = query.data ?? [];
  if (rows.length === 0) {
    return (
      <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
        <EmptyHeader>
          <HugeiconsIcon
            icon={ContainerIcon}
            strokeWidth={1.5}
            className="size-10 text-muted-foreground/50"
          />
          <EmptyTitle>{emptyTitle}</EmptyTitle>
          <EmptyDescription>{emptyText}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  return (
    <Card className="overflow-hidden rounded-md p-0 gap-0">
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((h, i) => (
              <TableHead
                key={h}
                className={cn(
                  i === 0 && "pl-4",
                  i === headers.length - 1 && "pr-4",
                )}
              >
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{children(pageRows)}</TableBody>
      </Table>
      {rows.length > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-4 border-t px-4 py-2.5">
          <span className="text-xs text-muted-foreground">
            Showing{" "}
            <span className="font-mono text-foreground">
              {start + 1}–{Math.min(start + PAGE_SIZE, rows.length)}
            </span>{" "}
            of <span className="font-mono text-foreground">{rows.length}</span>
          </span>
          <TablePager page={safePage} pageCount={pageCount} onPage={setPage} />
        </div>
      )}
    </Card>
  );
}

/** Windowed page list: first/last always shown, current ±1, ellipsis fills gaps. */
function pageWindow(
  current: number,
  total: number,
): Array<number | "ellipsis"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const out: Array<number | "ellipsis"> = [0];
  const left = Math.max(1, current - 1);
  const right = Math.min(total - 2, current + 1);
  if (left > 1) out.push("ellipsis");
  for (let i = left; i <= right; i++) out.push(i);
  if (right < total - 2) out.push("ellipsis");
  out.push(total - 1);
  return out;
}

function TablePager({
  page,
  pageCount,
  onPage,
}: {
  page: number;
  pageCount: number;
  onPage: (p: number) => void;
}) {
  const atStart = page === 0;
  const atEnd = page >= pageCount - 1;
  return (
    <Pagination className="mx-0 w-auto justify-end">
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            text=""
            aria-disabled={atStart}
            className={cn(atStart && "pointer-events-none opacity-50")}
            onClick={(e) => {
              e.preventDefault();
              if (!atStart) onPage(page - 1);
            }}
          />
        </PaginationItem>
        {pageWindow(page, pageCount).map((it, i) =>
          it === "ellipsis" ? (
            <PaginationItem key={`ellipsis-${i}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={it}>
              <PaginationLink
                isActive={it === page}
                onClick={(e) => {
                  e.preventDefault();
                  onPage(it);
                }}
              >
                {it + 1}
              </PaginationLink>
            </PaginationItem>
          ),
        )}
        <PaginationItem>
          <PaginationNext
            text=""
            aria-disabled={atEnd}
            className={cn(atEnd && "pointer-events-none opacity-50")}
            onClick={(e) => {
              e.preventDefault();
              if (!atEnd) onPage(page + 1);
            }}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

function PanelSkeleton({ cols }: { cols: number }) {
  return (
    <Card className="overflow-hidden rounded-md p-0 gap-0">
      <div className="flex items-center gap-4 border-b bg-muted/50 px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-16" />
        ))}
      </div>
      {Array.from({ length: 5 }).map((_, r) => (
        <div
          key={r}
          className="flex items-center gap-4 border-b border-border/60 px-4 py-3 last:border-b-0"
        >
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-4 w-20 flex-1" />
          ))}
        </div>
      ))}
    </Card>
  );
}

const TONE_CLASS: Record<StateTone, string> = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  info: "bg-info/10 text-info",
  destructive: "bg-destructive/10 text-destructive",
  muted: "bg-secondary text-secondary-foreground",
};

/**
 * Tone-tinted state badge (State-Tint Rule: low-opacity tint of its own hue +
 * same-hue text + a leading dot so state never rides on color alone). `label`
 * lets the containers table show the full daemon status line ("Up 4 minutes
 * (healthy)", "Exited (137) 1 hour ago") while `state` drives the tone.
 */
export function StateBadge({
  state,
  tone,
  label,
  title,
}: {
  state: string;
  tone?: StateTone;
  label?: string;
  title?: string;
}) {
  const resolved = tone ?? defaultTone(state);
  return (
    <Badge variant="secondary" className={cn("gap-1.5", TONE_CLASS[resolved])} title={title}>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current opacity-80" />
      {label || state || "—"}
    </Badge>
  );
}

function defaultTone(state: string): StateTone {
  const s = state.toLowerCase();
  if (s === "running") return "success";
  if (s === "exited" || s === "dead" || s === "failed" || s === "rejected") return "destructive";
  if (s === "restarting") return "warning";
  if (s === "paused") return "info";
  return "muted";
}
