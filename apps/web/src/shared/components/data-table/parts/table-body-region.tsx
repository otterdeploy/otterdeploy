/**
 * The four states the rows can be in, kept out of the shell so the shell reads
 * as a layout rather than a decision tree.
 *
 * Order matters: an error outranks a load (a retry beats a spinner that will
 * never resolve), and a load outranks empty (an empty table during the first
 * fetch is a lie the reader acts on).
 */

import type { RowData } from "@tanstack/react-table";

import type { useFeed } from "@/shared/components/data-table/feed/use-feed";
import type { Density } from "@/shared/components/data-table/parts/density";
import type { useDataTable } from "@/shared/components/data-table/use-data-table";

import { ROW_HEIGHT } from "@/shared/components/data-table/parts/density";
import {
  TableEmpty,
  TableError,
  TableFooterRow,
  TableSkeleton,
} from "@/shared/components/data-table/parts/table-states";
import { DataTableView } from "@/shared/components/data-table/parts/table-view";
import { toastMessage } from "@/shared/lib/errors";

type TableInstance<TRow extends RowData> = ReturnType<typeof useDataTable<TRow>>["table"];

export interface TableBodyRegionProps<TRow extends RowData> {
  feed: ReturnType<typeof useFeed<TRow>>;
  table: TableInstance<TRow>;
  rows: ReturnType<TableInstance<TRow>["getRowModel"]>["rows"];
  density: Density;
  hasFilters: boolean;
  onClearFilters: () => void;
  onOpenRow: (rowId: string | null) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  rowClassName?: (row: TRow) => string | undefined;
  /** The tail is running, so the top of the feed holds unseen rows. */
  isLive?: boolean;
}

export function TableBodyRegion<TRow extends RowData>({
  feed,
  table,
  rows,
  density,
  hasFilters,
  onClearFilters,
  onOpenRow,
  onLoadMore,
  hasMore,
  emptyTitle,
  emptyDescription,
  rowClassName,
  isLive = false,
}: TableBodyRegionProps<TRow>) {
  if (feed.isError) {
    return (
      <TableError
        message={toastMessage(feed.error, "Something went wrong loading these rows.")}
        onRetry={() => void feed.refetch()}
      />
    );
  }
  if (feed.isLoading) return <TableSkeleton height={ROW_HEIGHT[density]} />;
  if (rows.length === 0) {
    return (
      <TableEmpty
        hasFilters={hasFilters}
        onClearFilters={onClearFilters}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }
  return (
    <DataTableView
      table={table}
      rows={rows}
      density={density}
      onOpenRow={onOpenRow}
      onScrollEnd={onLoadMore}
      isLive={isLive}
      rowClassName={rowClassName ? (row) => rowClassName(row.original) : undefined}
      footer={
        <TableFooterRow
          loaded={feed.rows.length}
          filtered={feed.filterRowCount}
          total={feed.totalRowCount}
          hasMore={hasMore}
          isFetching={feed.isFetchingNextPage}
          onLoadMore={onLoadMore}
        />
      }
    />
  );
}
