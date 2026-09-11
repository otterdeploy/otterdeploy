/**
 * The Caddy event feed's columns.
 *
 * What this replaces: `edge-events-view.tsx` hand-rolled category chips, its own
 * search box, its own 2s `refetchInterval` and its own div rows — 159 lines that
 * re-answered questions the shared shell had already answered.
 *
 * The filter half of each declaration mirrors `packages/api/src/routers/
 * edge-logs/events-table.ts` — same keys, same types — because that is the same
 * declaration the server compiles into SQL. What lives HERE and only here is
 * presentation: the label, the width, how the value reads.
 *
 * What an operator reads here, in order: when it happened, how bad it is, what
 * kind of thing it was, and then the sentence. Level before category because
 * the first pass over this table is "is anything on fire", and category before
 * message because it is the axis you narrow by once something is.
 */

import type { EdgeEventFeedRow } from "@otterdeploy/api/routers/edge-logs/contract";

import type { BadgeTone, DataTableColumn } from "@/shared/components/data-table/schema/types";

import { CLOCK_WIDTH, CodeCell, EmptyCell } from "@/shared/components/data-table/cells";
import { cn } from "@/shared/lib/utils";

/** The feed's row, under the name the fixtures and the preview know it by. */
export type EdgeEventRow = EdgeEventFeedRow;

/** Outline + text per tone — the same chip the access log's method column uses,
 *  so a level and a method read as the same kind of thing. */
const LEVEL_CHIP: Record<BadgeTone, string> = {
  info: "border-info/30 text-info",
  success: "border-success/30 text-success",
  warning: "border-warning/40 text-warning",
  danger: "border-destructive/30 text-destructive",
  neutral: "border-border text-muted-foreground",
};

/** Level → the semantic vocabulary. `error` is the row this table exists for. */
function levelTone(value: unknown): BadgeTone {
  if (value === "error") return "danger";
  if (value === "warn") return "warning";
  if (value === "debug") return "neutral";
  return "info";
}

/**
 * Histogram bands, from the shared severity bands.
 *
 * A level is not an HTTP status, so these name the SEVERITY (`bad`, `warn`,
 * `info`) rather than borrowing the access log's `--chart-*xx` tokens — which
 * is what made this chart read as a request feed. `debug` stays on the
 * greyscale ramp: it is the least interesting thing in the window and should
 * not compete with the two bands anyone opened this table to find.
 */
export const EDGE_EVENT_LEVEL_TONES: Record<string, string> = {
  error: "var(--chart-band-bad)",
  warn: "var(--chart-band-warn)",
  info: "var(--chart-band-info)",
  debug: "var(--chart-2)",
};

/** Stack order, bottom-first: the ordinary case sits under the exceptions. */
export const EDGE_EVENT_LEVEL_ORDER = ["debug", "info", "warn", "error"] as const;

/**
 * What this event is about, in one column.
 *
 * `hosts` is the row's own `host` unioned with any certificate batch's
 * `domains`, narrowed to the ones this org owns — one key for both, because
 * they answer one question. Splitting them, as the stored columns do, is how a
 * reader filtering for `api.example.com` gets every upstream error for it and
 * not one word about its certificate: a renewal carries no `host` at all.
 *
 * A batch covering several of your domains shows the first and counts the rest.
 * Listing six hostnames in a 190px cell renders as one illegible smear, and the
 * full list is a click away in the sheet.
 */
function EventHosts({ row }: { row: EdgeEventRow }) {
  const [first, ...rest] = row.hosts;
  if (first === undefined) return <EmptyCell />;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate font-mono text-[12px]" title={row.hosts.join(", ")}>
        {first}
      </span>
      {rest.length > 0 ? (
        <span className="shrink-0 rounded-[3px] bg-muted px-1 font-mono text-[10px] text-muted-foreground">
          +{rest.length}
        </span>
      ) : null}
    </span>
  );
}

export const edgeEventColumns: readonly DataTableColumn<EdgeEventRow>[] = [
  {
    key: "ts",
    label: "Time",
    kind: "instant",
    display: { type: "clock" },
    sortable: true,
    width: CLOCK_WIDTH,
    filter: { type: "timerange", defaultOpen: true, commandDisabled: true },
  },
  {
    key: "level",
    label: "Level",
    kind: "enum",
    width: 82,
    filter: { type: "checkbox", defaultOpen: true },
    // A bordered chip, like the access log's method: the level is scanned DOWN
    // the column, and a repeating outline is what the eye locks onto.
    cell: ({ row }) => (
      <span
        className={cn(
          // The level is written `warn` in the log; printing WARN is the table
          // editorialising a value it is meant to be reporting.
          "inline-flex items-center rounded-[4px] border px-1.5 py-px font-mono text-[10px] font-semibold tracking-wide",
          LEVEL_CHIP[levelTone(row.level)],
        )}
      >
        {row.level}
      </span>
    ),
  },
  {
    key: "category",
    label: "Category",
    kind: "enum",
    width: 112,
    filter: { type: "checkbox", defaultOpen: true },
    // A quiet filled tag, deliberately NOT the outlined chip: category is what
    // you narrow by, level is what you scan for, and giving them the same shape
    // would make the row read as two competing labels.
    cell: ({ row }) => (
      <span className="inline-flex items-center rounded-[3px] bg-muted px-1.5 py-px font-mono text-[10px] tracking-wide text-muted-foreground">
        {row.category}
      </span>
    ),
  },
  {
    key: "msg",
    label: "Message",
    kind: "string",
    minWidth: 260,
    // Sans, not mono: this is Caddy talking in sentences, and setting it in
    // mono would say "paste me somewhere", which is not true of a message.
    display: { type: "text" },
  },
  {
    key: "hosts",
    label: "Host",
    kind: "array",
    itemKind: "string",
    width: 190,
    filter: { type: "checkbox", defaultOpen: true },
    cell: ({ row }) => <EventHosts row={row} />,
    // The grid counts the rest; the sheet is where they are actually listed.
    sheet: {
      label: "Hosts",
      render: (row) => (
        <span className="flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[12px]">
          {row.hosts.length === 0 ? (
            <EmptyCell />
          ) : (
            row.hosts.map((host) => <span key={host}>{host}</span>)
          )}
        </span>
      ),
    },
  },
  {
    key: "logger",
    label: "Logger",
    kind: "string",
    display: { type: "code" },
    width: 150,
    hidden: true,
    filter: { type: "checkbox" },
  },
  {
    key: "upstream",
    label: "Upstream",
    kind: "string",
    display: { type: "code" },
    width: 160,
    hidden: true,
    cell: ({ row }) => (row.upstream ? <CodeCell value={row.upstream} /> : <EmptyCell />),
  },
  {
    key: "error",
    label: "Error",
    kind: "string",
    display: { type: "code" },
    minWidth: 200,
    hidden: true,
    cell: ({ row }) => (row.error ? <CodeCell value={row.error} /> : <EmptyCell />),
  },
  {
    // The host Caddy itself attributed the line to, which is NULL on anything
    // batched. Hidden, because `Host` above already answers the question a
    // reader is asking; this answers the narrower one the sheet is for.
    key: "host",
    label: "Reported host",
    kind: "string",
    display: { type: "code" },
    width: 180,
    hidden: true,
    cell: ({ row }) => (row.host ? <CodeCell value={row.host} /> : <EmptyCell />),
  },
  {
    key: "domains",
    label: "Certificate batch",
    kind: "array",
    itemKind: "string",
    width: 180,
    hidden: true,
  },
  {
    // Filter only: it spans the message, the error and the raw line, so it is
    // not any one of them — but its semantics belong beside theirs.
    key: "q",
    label: "Search",
    kind: "string",
    filterOnly: true,
    filter: { type: "search", keys: ["msg", "error", "logger", "host", "upstream", "raw"] },
  },
  {
    // Never a column — a wall of JSON in a 200px cell is noise — but the first
    // thing anyone wants once a row is worth opening.
    key: "raw",
    label: "Raw line",
    kind: "string",
    display: { type: "code" },
    hidden: true,
    sheet: {
      label: "Raw",
      block: true,
      render: (row) => (
        <pre className="max-h-64 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[11px] whitespace-pre-wrap">
          {row.raw}
        </pre>
      ),
    },
  },
];
