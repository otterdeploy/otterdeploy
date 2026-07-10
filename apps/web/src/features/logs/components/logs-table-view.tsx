/**
 * The virtualized log table itself — the scroll container, sticky header,
 * windowed rows and the "jump to latest" pill. Split out of the logs route so
 * the route's component stays small; all live-tail wiring (table instance,
 * virtualizer, follow state) is owned by the route and threaded in as props.
 */

import type { Virtualizer } from "@tanstack/react-virtual";

import type { RefObject } from "react";

import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { flexRender, type Row, type Table } from "@tanstack/react-table";

import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";

import type { LogStreamStatus } from "./logs-status";

import { LEVEL_STRIPE, type LogLine } from "../data/use-project-log-stream";

interface LogsTableViewProps {
  table: Table<LogLine>;
  rows: Row<LogLine>[];
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  scrollRef: RefObject<HTMLDivElement | null>;
  status: LogStreamStatus;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  isDefaultSort: boolean;
  hasTimeRange: boolean;
  matchCount: number;
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
}

export function LogsTableView({
  table,
  rows,
  virtualizer,
  scrollRef,
  status,
  selectedId,
  onSelect,
  isDefaultSort,
  hasTimeRange,
  matchCount,
  follow,
  onFollowChange,
}: LogsTableViewProps) {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          onFollowChange(atBottom && isDefaultSort);
        }}
        className="min-h-0 flex-1 overflow-auto"
      >
        {/* Raw <table> (not the shadcn Table wrapper) so there's no
            overflow-x container div between the scroll element and the
            grid table — that wrapper turns overflow-y into a nested scroll
            context and breaks the sticky header + virtualizer. */}
        <table className="grid w-full caption-bottom text-sm">
          <LogsTableHeader table={table} />
          {matchCount === 0 ? null : (
            <LogsTableBody
              rows={rows}
              virtualizer={virtualizer}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          )}
        </table>

        {matchCount === 0 && (
          <div className="py-16 text-center text-[13px] text-muted-foreground">
            {status === "connecting" ? "Connecting to log stream…" : "No logs match these filters."}
          </div>
        )}
      </div>

      {!follow && isDefaultSort && !hasTimeRange && matchCount > 0 && (
        <button
          type="button"
          onClick={() => onFollowChange(true)}
          className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-[11px] font-medium shadow-md hover:bg-muted"
        >
          <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-3.5" />
          Jump to latest
        </button>
      )}
    </div>
  );
}

function LogsTableHeader({ table }: { table: Table<LogLine> }) {
  return (
    <TableHeader className="sticky top-0 z-10 grid bg-background">
      {table.getHeaderGroups().map((hg) => (
        <TableRow key={hg.id} className="flex w-full hover:bg-transparent">
          {hg.headers.map((h) => {
            const isMsg = h.column.id === "message";
            const sorted = h.column.getIsSorted();
            return (
              <TableHead
                key={h.id}
                style={isMsg ? undefined : { width: h.getSize() }}
                className={cn(
                  "flex h-8 items-center text-[10px] font-semibold tracking-[0.06em] text-muted-foreground uppercase",
                  isMsg ? "min-w-0 flex-1" : "shrink-0",
                )}
              >
                {h.isPlaceholder ? null : h.column.getCanSort() ? (
                  <button
                    type="button"
                    onClick={h.column.getToggleSortingHandler()}
                    className="flex items-center gap-1 hover:text-foreground"
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {sorted && (
                      <HugeiconsIcon
                        icon={sorted === "asc" ? ArrowUp01Icon : ArrowDown01Icon}
                        strokeWidth={2}
                        className="size-3"
                      />
                    )}
                  </button>
                ) : (
                  flexRender(h.column.columnDef.header, h.getContext())
                )}
              </TableHead>
            );
          })}
        </TableRow>
      ))}
    </TableHeader>
  );
}

interface LogsTableBodyProps {
  rows: Row<LogLine>[];
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function LogsTableBody({ rows, virtualizer, selectedId, onSelect }: LogsTableBodyProps) {
  return (
    <TableBody className="relative grid" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((vi) => {
        const row = rows[vi.index];
        if (!row) return null;
        return (
          <TableRow
            key={row.id}
            data-index={vi.index}
            ref={virtualizer.measureElement}
            data-state={selectedId === row.id ? "selected" : undefined}
            onClick={() => onSelect(row.id)}
            style={{ transform: `translateY(${vi.start}px)` }}
            className="absolute flex w-full cursor-pointer border-b font-mono"
          >
            {row.getVisibleCells().map((cell, i) => {
              const isMsg = cell.column.id === "message";
              // The select checkbox acts on the row itself — a click there must
              // not also open the detail panel, including clicks on the cell
              // padding around the small control.
              const isControl = cell.column.id === "select";
              return (
                <TableCell
                  key={cell.id}
                  onClick={isControl ? (e) => e.stopPropagation() : undefined}
                  style={isMsg ? undefined : { width: cell.column.getSize() }}
                  className={cn(
                    "relative flex items-start px-2 py-1 whitespace-normal",
                    isMsg ? "min-w-0 flex-1" : "shrink-0",
                  )}
                >
                  {i === 0 && (
                    <span
                      className={cn(
                        "absolute top-0 left-0 h-full w-0.5",
                        LEVEL_STRIPE[row.original.level],
                      )}
                      aria-hidden
                    />
                  )}
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              );
            })}
          </TableRow>
        );
      })}
    </TableBody>
  );
}
