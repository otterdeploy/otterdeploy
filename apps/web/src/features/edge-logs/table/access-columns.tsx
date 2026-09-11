/**
 * The edge access log's columns.
 *
 * What this replaces: `edge-logs-view.tsx` and its parts — a 2s
 * `refetchInterval`, its own histogram, its own time-range picker, its own host
 * filter, its own div rows and its own expand-a-row panel.
 *
 * The colour vocabulary is the one the old view already used and got right:
 * GET blue, POST green, PUT/PATCH amber, DELETE red; 2xx green, 3xx blue, 4xx
 * amber, 5xx red. It moves here as TONES rather than Tailwind classes, so the
 * method chip, the status text, the histogram band and a badge anywhere else in
 * the app are all the same five colours — the old file hard-coded
 * `text-sky-500` and friends, which is how a sixth vocabulary starts.
 */

import type { EdgeAccessFeedRow } from "@otterdeploy/api/routers/edge-logs/contract";

import type { DataTableColumn } from "@/shared/components/data-table/schema/types";

import { shortUserAgent } from "@/features/edge-logs/components/edge-logs-ua";
import {
  CountryLabel,
  EDGE_ACCESS_STATUS_ORDER,
  EDGE_ACCESS_STATUS_TONES,
  LATENCY_FILL,
  METHOD_CHIP,
  methodTone,
  statusTone,
} from "@/features/edge-logs/table/access-cells";
import { classifyThreat } from "@/features/edge-logs/threat";
import { CLOCK_WIDTH, CodeCell, EmptyCell } from "@/shared/components/data-table/cells";
import { cn } from "@/shared/lib/utils";

/**
 * The feed's row, under the name the fixtures and the preview know it by.
 *
 * `statusClass` and `suspicious` are DERIVED keys the server compiles from SQL
 * expressions and sends ON the row — so the WHERE clause, the facet counts and
 * the client evaluator all read the same value rather than three recomputations
 * of it. See `routers/edge-logs/access-table.ts`.
 */
export type EdgeAccessRow = EdgeAccessFeedRow;

export const edgeAccessColumns: readonly DataTableColumn<EdgeAccessRow>[] = [
  {
    key: "ts",
    label: "Time",
    kind: "instant",
    sortable: true,
    width: CLOCK_WIDTH,
    // A CLOCK, not "43 seconds ago": access-log rows arrive seconds apart, so
    // twenty relative stamps all read the same and none can be lined up against
    // an alert, a deploy or another log. See `ClockCell`.
    display: { type: "clock" },
    filter: { type: "timerange", defaultOpen: true, commandDisabled: true },
  },
  {
    key: "method",
    label: "Method",
    kind: "enum",
    width: 84,
    filter: { type: "checkbox", defaultOpen: true },
    // A bordered chip, not bare text: the method is the one column a reader
    // scans down rather than reads across, and an outline gives the eye a
    // repeating shape to lock onto between two mono columns.
    cell: ({ row }) => (
      <span
        className={cn(
          "inline-flex items-center rounded-[4px] border px-1.5 py-px font-mono text-[10px] font-semibold tracking-wide",
          METHOD_CHIP[methodTone(row.method)],
        )}
      >
        {row.method}
      </span>
    ),
  },
  {
    key: "status",
    label: "Status",
    kind: "number",
    display: { type: "code", tone: statusTone },
    width: 72,
    cellClassName: "font-semibold",
    sortable: true,
    filter: { type: "checkbox", defaultOpen: true },
  },
  {
    /**
     * Filter only: the same four bands the histogram draws.
     *
     * It is the histogram's `histogramKey`, which is what makes the legend a
     * filter — clicking the red band shows the 5xx. The `status` column beside
     * it is the exact code, which is the other question ("404 or 410?") and
     * cannot be folded into this one.
     */
    key: "statusClass",
    label: "Status class",
    kind: "enum",
    filterOnly: true,
    filter: {
      type: "checkbox",
      defaultOpen: true,
      options: [
        { label: "2xx", value: "2xx" },
        { label: "3xx", value: "3xx" },
        { label: "4xx", value: "4xx" },
        { label: "5xx", value: "5xx" },
      ],
    },
  },
  {
    key: "path",
    label: "Path",
    kind: "string",
    minWidth: 200,
    // Mono, because a path is what you copy into the next request — with the
    // probe category in front of it when the path is one. `/config.json` and
    // `/wp-login.php` are not ordinary 404s, and the reader should not have to
    // recognise every scanner path by sight to know that.
    cell: ({ row }) => {
      const threat = classifyThreat(row.path);
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          {threat ? (
            <span className="shrink-0 rounded-[3px] bg-destructive/10 px-1 py-px font-mono text-[9.5px] font-semibold tracking-wide text-destructive uppercase">
              {threat}
            </span>
          ) : null}
          <span className="truncate font-mono text-[12px] text-foreground/85" title={row.path}>
            {row.path}
          </span>
        </span>
      );
    },
  },
  {
    key: "latencyMs",
    label: "Latency",
    kind: "number",
    width: 112,
    sortable: true,
    filter: { type: "slider", min: 0, max: 5000 },
    // The figure AND a bar, with the bar tinted by threshold. A uniform bar
    // says how long relative to a second; a red one says "this is the row you
    // came here for" without the reader comparing numbers down the column.
    cell: ({ row }) => (
      <span className="flex items-center justify-end gap-2 tabular-nums">
        <span className="font-mono text-[12px]">
          {row.latencyMs}
          <span className="ml-0.5 text-muted-foreground">ms</span>
        </span>
        <span aria-hidden className="h-1 w-8 shrink-0 overflow-hidden rounded-full bg-muted">
          <span
            className={cn("block h-full rounded-full", LATENCY_FILL(row.latencyMs))}
            style={{ width: `${Math.min(100, (row.latencyMs / 1000) * 100)}%` }}
          />
        </span>
      </span>
    ),
  },
  {
    key: "host",
    label: "Host",
    kind: "string",
    display: { type: "code" },
    width: 152,
    filter: { type: "checkbox" },
  },
  {
    key: "clientIp",
    label: "Client",
    kind: "string",
    display: { type: "code" },
    width: 118,
    filter: { type: "checkbox" },
  },
  {
    key: "country",
    label: "Country",
    kind: "enum",
    width: 78,
    filter: { type: "checkbox", optionLabel: (value) => <CountryLabel code={String(value)} /> },
    cell: ({ row }) => (row.country ? <CountryLabel code={row.country} /> : <EmptyCell />),
  },
  {
    key: "upstream",
    label: "Upstream",
    kind: "string",
    display: { type: "code" },
    width: 150,
    hidden: true,
    filter: { type: "checkbox" },
    cell: ({ row }) => (row.upstream ? <CodeCell value={row.upstream} /> : <EmptyCell />),
  },
  {
    key: "cache",
    label: "Cache",
    kind: "enum",
    display: {
      type: "code",
      // HIT is the outcome worth having; BYPASS and the stale states are worth
      // a glance. MISS is ordinary, so it stays uncoloured.
      tone: (value) => {
        const state = String(value).toUpperCase();
        if (state === "HIT") return "success";
        if (state === "BYPASS" || state === "EXPIRED" || state === "STALE") return "warning";
        return "neutral";
      },
    },
    width: 86,
    hidden: true,
    filter: { type: "checkbox" },
    cell: ({ row }) => (row.cache ? <CodeCell value={row.cache} /> : <EmptyCell />),
  },
  {
    key: "resBytes",
    label: "Size",
    kind: "number",
    display: { type: "number", unit: "B" },
    width: 90,
    hidden: true,
    sortable: true,
  },
  {
    key: "userAgent",
    label: "UA",
    kind: "string",
    width: 150,
    // No checkbox filter, unlike the columns around it. A user-agent string is
    // open-ended — a busy day has thousands of distinct ones, most seen once —
    // so an option list over it is a list of every visitor's browser build,
    // which answers nothing. It is in the search keys instead, where "Chrome"
    // or "curl" is what someone actually types.
    // "Chrome 145 / macOS", not 130 characters of version soup. The raw string
    // is still in the row sheet for anyone who needs to see the whole thing.
    cell: ({ row }) => (
      <span
        className="block truncate font-mono text-[12px] text-muted-foreground"
        title={row.userAgent}
      >
        {shortUserAgent(row.userAgent)}
      </span>
    ),
  },
  {
    // Hidden, but present: the sheet is where "who sent them here" belongs, and
    // it is one of the columns the search box spans.
    key: "referer",
    label: "Referer",
    kind: "string",
    display: { type: "code" },
    width: 180,
    hidden: true,
  },
  {
    key: "requestId",
    label: "Request id",
    kind: "string",
    display: { type: "code" },
    width: 150,
    hidden: true,
  },
  {
    key: "suspicious",
    label: "Suspicious",
    kind: "enum",
    /**
     * Scanner probes only — the old view's headline filter, and the second key
     * the widened `ColumnMap` makes possible.
     *
     * Derived, like the firewall's state: the server maps it to the same regex
     * `classifyThreat` mirrors, as an expression rather than a column —
     *
     *   suspicious: sql`case when path ~* ${THREAT_RE} then 'yes' else 'no' end`
     *
     * — and the row carries the value so the client evaluator agrees. Declared
     * options rather than facets so "no 0" is readable rather than a row that
     * vanished.
     */
    filterOnly: true,
    filter: {
      type: "checkbox",
      defaultOpen: true,
      options: [
        { label: "probes only", value: "yes" },
        { label: "ordinary traffic", value: "no" },
      ],
    },
  },
  {
    key: "q",
    label: "Search",
    kind: "string",
    filterOnly: true,
    filter: { type: "search", keys: ["path", "host", "clientIp", "userAgent", "referer"] },
  },
  {
    key: "headers",
    label: "Request headers",
    kind: "string",
    hidden: true,
    sheet: {
      block: true,
      render: (row) => (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-[11px]">
          {Object.entries(row.headers).map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="text-muted-foreground">{name}</dt>
              <dd className="truncate">{value}</dd>
            </div>
          ))}
        </dl>
      ),
    },
  },
];

export { EDGE_ACCESS_STATUS_ORDER, EDGE_ACCESS_STATUS_TONES };
