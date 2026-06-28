/**
 * Presentational pieces for the MariaDB/MySQL "Data" tab — the table picker
 * rail, the paginated row pane, the row grid, and the shared pager. These are
 * split out of `index.tsx` to keep that file focused on data wiring; the Mongo
 * data tab reuses `Pager` from here too (via the index re-export).
 */
import { ArrowLeft01Icon, ArrowRight01Icon, Table01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
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
import { cn } from "@/shared/lib/utils";

export const PAGE = 100;

export interface TableRef {
  schema: string;
  name: string;
}

/** Left rail: schema-qualified table list with loading / error / empty states. */
export function TablePicker({
  isLoading,
  isError,
  onRetry,
  tables,
  active,
  onPick,
}: {
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  tables: TableRef[];
  active: TableRef | null;
  onPick: (t: TableRef) => void;
}) {
  return (
    <div className="flex w-56 shrink-0 flex-col overflow-y-auto rounded-md ring-1 ring-foreground/10">
      {isLoading ? (
        <div className="flex flex-col gap-1 p-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState message="Couldn’t list tables" onRetry={onRetry} />
      ) : tables.length === 0 ? (
        <div className="p-3 text-[12px] text-muted-foreground">No tables.</div>
      ) : (
        <ul className="p-1">
          {tables.map((t) => {
            const isActive = active?.schema === t.schema && active?.name === t.name;
            return (
              <li key={`${t.schema}.${t.name}`}>
                <button
                  type="button"
                  onClick={() => onPick({ schema: t.schema, name: t.name })}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left font-mono text-[12px]",
                    isActive ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                  )}
                >
                  <HugeiconsIcon
                    icon={Table01Icon}
                    strokeWidth={2}
                    className="size-3.5 shrink-0 opacity-60"
                  />
                  <span className="truncate">{t.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Right pane: paginated row grid for the active table, or an empty prompt. */
export function RowPanel({
  active,
  offset,
  isLoading,
  isError,
  isFetching,
  hasMore,
  columns,
  rows,
  onRetry,
  onPrev,
  onNext,
}: {
  active: TableRef | null;
  offset: number;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  hasMore: boolean;
  columns: string[];
  rows: Array<Array<string | null>>;
  onRetry: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col rounded-md ring-1 ring-foreground/10">
      {!active ? (
        <Empty className="h-full">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Table01Icon} strokeWidth={2} className="size-5" />
            </EmptyMedia>
            <EmptyTitle>Pick a table</EmptyTitle>
            <EmptyDescription>Select a table to browse its rows.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
            <span className="truncate font-mono text-[12px]">
              {active.schema}.{active.name}
            </span>
            <Pager
              offset={offset}
              page={PAGE}
              hasMore={hasMore}
              loading={isFetching}
              onPrev={onPrev}
              onNext={onNext}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {isLoading ? (
              <div className="flex flex-col gap-1 p-2">
                {Array.from({ length: 10 }).map((_, i) => (
                  <Skeleton key={i} className="h-7 w-full" />
                ))}
              </div>
            ) : isError ? (
              <ErrorState message="Couldn’t read rows" onRetry={onRetry} />
            ) : (
              <Grid columns={columns} rows={rows} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Grid({ columns, rows }: { columns: string[]; rows: Array<Array<string | null>> }) {
  if (rows.length === 0) {
    return <div className="p-4 text-[12px] text-muted-foreground">No rows.</div>;
  }
  return (
    <Table className="text-[12px]">
      <TableHeader className="sticky top-0 bg-card">
        <TableRow>
          {columns.map((c) => (
            <TableHead key={c} className="h-8 font-mono text-[11px]">
              {c}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={i}>
            {r.map((cell, j) => (
              <TableCell key={j} className="max-w-xs truncate font-mono">
                {cell === null ? <span className="text-muted-foreground italic">NULL</span> : cell}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function Pager({
  offset,
  page,
  hasMore,
  loading,
  onPrev,
  onNext,
}: {
  offset: number;
  page: number;
  hasMore: boolean;
  loading: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground tabular-nums">
        {offset + 1}–{offset + page}
      </span>
      <Button
        variant="outline"
        size="icon-sm"
        disabled={offset === 0 || loading}
        onClick={onPrev}
        aria-label="Previous page"
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} className="size-3.5" />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        disabled={!hasMore || loading}
        onClick={onNext}
        aria-label="Next page"
      >
        <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3.5" />
      </Button>
    </div>
  );
}
