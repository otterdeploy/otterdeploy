// Headless TanStack column model for the project logs table. Rendering (the
// virtualized flex rows) lives in logs-table-view; here we only describe columns,
// sorting, and per-cell content. `wrap` is read off table meta so toggling it
// doesn't churn the column identities.

import type { ColumnDef, RowData } from "@tanstack/react-table";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Checkbox } from "@/shared/components/ui/checkbox";
import { cn } from "@/shared/lib/utils";

import {
  LEVEL_TEXT,
  LOG_LEVELS,
  type LogLevel,
  type LogLine,
} from "../data/use-project-log-stream";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface TableMeta<TData extends RowData> {
    /** Wrap long messages (multi-line, grows the row) vs single-line truncate. */
    wrap?: boolean;
  }
}

const levelRank = (lv: LogLevel) => LOG_LEVELS.indexOf(lv);

export const logColumns: ColumnDef<LogLine>[] = [
  {
    id: "select",
    size: 36,
    enableSorting: false,
    header: ({ table }) => (
      <Checkbox
        aria-label="Select all"
        checked={table.getIsAllRowsSelected()}
        indeterminate={table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected()}
        onCheckedChange={(v) => table.toggleAllRowsSelected(!!v)}
      />
    ),
    cell: ({ row }) => (
      // Stop propagation so ticking the box doesn't also open the detail panel.
      <span onClick={(e) => e.stopPropagation()}>
        <Checkbox
          aria-label="Select row"
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
        />
      </span>
    ),
  },
  {
    id: "expander",
    size: 28,
    enableSorting: false,
    header: () => null,
    cell: ({ row }) => (
      // Inline fold — expand the row in place to read the whole entry, collapse
      // to fold it back. Independent of the side detail panel (row click), so
      // stop propagation here.
      <button
        type="button"
        aria-label={row.getIsExpanded() ? "Collapse" : "Expand"}
        onClick={(e) => {
          e.stopPropagation();
          row.toggleExpanded();
        }}
        className="flex items-center justify-center text-muted-foreground/60 hover:text-foreground"
      >
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          strokeWidth={2}
          className={cn("size-3 transition-transform", row.getIsExpanded() && "rotate-90")}
        />
      </button>
    ),
  },
  {
    id: "timestamp",
    accessorKey: "tsIso",
    size: 150,
    header: "Timestamp",
    cell: ({ row }) => (
      <span className="text-[11.5px] text-muted-foreground">{row.original.ts}</span>
    ),
  },
  {
    id: "level",
    accessorKey: "level",
    size: 70,
    header: "Level",
    sortingFn: (a, b) => levelRank(a.original.level) - levelRank(b.original.level),
    cell: ({ row }) => (
      <span
        className={cn(
          "text-[10px] font-medium tracking-[0.08em] uppercase",
          LEVEL_TEXT[row.original.level],
        )}
      >
        {row.original.level}
      </span>
    ),
  },
  {
    id: "service",
    accessorKey: "svc",
    size: 120,
    header: "Service",
    cell: ({ row }) => (
      <span className="truncate text-xs text-foreground/80">{row.original.svc}</span>
    ),
  },
  {
    id: "message",
    accessorKey: "msg",
    enableSorting: false,
    header: "Message",
    cell: ({ row, table }) => {
      const msg = row.original.msg;
      const wrap = table.options.meta?.wrap ?? true;
      // Only an expanded (chevron-opened) row shows the whole entry. Collapsed
      // rows stay one logical line so multi-line stack traces / objects don't
      // blow the table open by default — `wrap` just decides whether that one
      // line wraps or truncates.
      if (row.getIsExpanded()) {
        return (
          <span className="min-w-0 flex-1 text-xs wrap-break-word whitespace-pre-wrap text-foreground">
            {msg}
          </span>
        );
      }
      const firstBreak = msg.indexOf("\n");
      const summary = firstBreak === -1 ? msg : msg.slice(0, firstBreak);
      const extra = firstBreak === -1 ? 0 : msg.split("\n").length - 1;
      return (
        <span
          className={cn(
            "min-w-0 flex-1 text-xs text-foreground",
            wrap ? "wrap-break-word" : "truncate",
          )}
        >
          {summary}
          {extra > 0 && (
            <span className="ml-2 rounded-sm bg-muted px-1.5 py-0.5 align-middle text-[10px] font-medium text-muted-foreground/80">
              +{extra}
            </span>
          )}
        </span>
      );
    },
  },
];
