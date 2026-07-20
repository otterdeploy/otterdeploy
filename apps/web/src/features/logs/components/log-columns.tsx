// Headless TanStack column model for the project logs table. Rendering (the
// virtualized flex rows) lives in logs-table-view; here we only describe
// columns, sorting, and per-cell content. Every row is a single fixed-height
// line — full entries open in the side detail panel (row click), never inline,
// so the virtualizer's rows stay uniform and can't overlap.

import type { ColumnDef } from "@tanstack/react-table";

import { Checkbox } from "@/shared/components/ui/checkbox";
import { cn } from "@/shared/lib/utils";

import {
  LEVEL_TEXT,
  LOG_LEVELS,
  type LogLevel,
  type LogLine,
} from "../data/use-project-log-stream";
import { stripAnsi } from "./ansi";

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
    cell: ({ row }) => {
      // Strip ANSI/SGR escapes: build/runtime tools emit color codes that would
      // otherwise render as literal `[32m…` garbage in the (uncolored) table.
      const msg = stripAnsi(row.original.msg);
      // Every row is ALWAYS a single truncated line, so all rows share one
      // fixed height. That is what keeps the virtualizer's size estimate exact
      // and its absolutely-positioned rows from overlapping: a soft-wrapped row
      // grows to the full many-line height of a long JSON log entry, and the
      // virtualizer's post-paint measurement can't reliably repaint that under
      // a bursty live tail, so tall rows smeared over each other into an
      // unreadable overlap. Click a row to read the whole entry (pretty-printed
      // JSON, metadata) in the side detail panel — that overlays the table
      // instead of reflowing it.
      const firstBreak = msg.indexOf("\n");
      const summary = firstBreak === -1 ? msg : msg.slice(0, firstBreak);
      const extra = firstBreak === -1 ? 0 : msg.split("\n").length - 1;
      return (
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">
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
