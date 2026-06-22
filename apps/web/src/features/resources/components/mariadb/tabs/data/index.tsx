/**
 * "Data" tab for a MariaDB/MySQL resource — a read-only table browser.
 *
 * Unlike the Postgres SQL console this is deliberately a browser: a table list
 * on the left, a paginated row grid on the right. The server builds every
 * statement (no free-text SQL), so nothing here can write.
 */
import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, ArrowRight01Icon, Table01Icon } from "@hugeicons/core-free-icons";

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

import type { PostgresBodyProps } from "../../../postgres/types";
import { useMariadbRows, useMariadbTables } from "./data/use-mariadb";

const PAGE = 100;

export function MariadbDataTabBody({
  resource,
}: {
  resource: PostgresBodyProps["resource"];
}) {
  const resourceId = resource.resourceId;
  const tablesQuery = useMariadbTables(resourceId);
  const [selected, setSelected] = useState<{ schema: string; table: string } | null>(
    null,
  );
  const [offset, setOffset] = useState(0);

  const tables = tablesQuery.data?.tables ?? [];
  const active = selected ?? tables[0] ?? null;

  const rowsQuery = useMariadbRows({
    resourceId,
    schema: active?.schema ?? "",
    table: active?.table ?? "",
    limit: PAGE,
    offset,
    enabled: Boolean(active),
  });

  const pick = (t: { schema: string; table: string }) => {
    setSelected(t);
    setOffset(0);
  };

  return (
    <div className="flex min-h-0 gap-3" style={{ height: "60vh" }}>
      {/* Table list */}
      <div className="flex w-56 shrink-0 flex-col overflow-y-auto rounded-md ring-1 ring-foreground/10">
        {tablesQuery.isLoading ? (
          <div className="flex flex-col gap-1 p-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : tablesQuery.isError ? (
          <ErrorState
            message="Couldn’t list tables"
            onRetry={() => void tablesQuery.refetch()}
          />
        ) : tables.length === 0 ? (
          <div className="p-3 text-[12px] text-muted-foreground">No tables.</div>
        ) : (
          <ul className="p-1">
            {tables.map((t) => {
              const isActive = active?.schema === t.schema && active?.table === t.table;
              return (
                <li key={`${t.schema}.${t.name}`}>
                  <button
                    type="button"
                    onClick={() => pick({ schema: t.schema, table: t.name })}
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-[12px] font-mono",
                      isActive ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                    )}
                  >
                    <HugeiconsIcon icon={Table01Icon} strokeWidth={2} className="size-3.5 shrink-0 opacity-60" />
                    <span className="truncate">{t.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Row grid */}
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
                {active.schema}.{active.table}
              </span>
              <Pager
                offset={offset}
                page={PAGE}
                hasMore={rowsQuery.data?.hasMore ?? false}
                loading={rowsQuery.isFetching}
                onPrev={() => setOffset((o) => Math.max(0, o - PAGE))}
                onNext={() => setOffset((o) => o + PAGE)}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {rowsQuery.isLoading ? (
                <div className="flex flex-col gap-1 p-2">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <Skeleton key={i} className="h-7 w-full" />
                  ))}
                </div>
              ) : rowsQuery.isError ? (
                <ErrorState
                  message="Couldn’t read rows"
                  onRetry={() => void rowsQuery.refetch()}
                />
              ) : (
                <Grid columns={rowsQuery.data?.columns ?? []} rows={rowsQuery.data?.rows ?? []} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Grid({
  columns,
  rows,
}: {
  columns: string[];
  rows: Array<Array<string | null>>;
}) {
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
                {cell === null ? (
                  <span className="italic text-muted-foreground">NULL</span>
                ) : (
                  cell
                )}
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
      <span className="text-[11px] tabular-nums text-muted-foreground">
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
