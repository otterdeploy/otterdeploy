/**
 * The audit feed's columns.
 *
 * The filter half of each declaration mirrors `packages/api/src/routers/audit/
 * table.ts` — same keys, same types — because that is the same declaration the
 * server compiles into SQL. What lives HERE and only here is presentation: the
 * label, the width, how the value reads.
 *
 * What an audit reader scans, in order: when, who, what, and did it work. The
 * column order is that sentence.
 */

import type { AuditFeedRow } from "@otterdeploy/api/routers/audit/contract";

import type { BadgeTone, DataTableColumn } from "@/shared/components/data-table/schema/types";

import { CodeCell, EmptyCell } from "@/shared/components/data-table/cells";

/** Outcome → the semantic vocabulary. Denial is the row an operator hunts for. */
function outcomeTone(value: unknown): BadgeTone {
  if (value === "denied") return "danger";
  if (value === "failure") return "warning";
  return "success";
}

/** Histogram bar colours, matching the outcome tones exactly. */
export const AUDIT_OUTCOME_TONES: Record<string, string> = {
  success: "var(--chart-3)",
  failure: "var(--warning)",
  denied: "var(--destructive)",
};

/** Stack order, bottom-first: the ordinary case sits under the exceptions. */
export const AUDIT_OUTCOME_ORDER = ["success", "failure", "denied"] as const;

export const auditColumns: readonly DataTableColumn<AuditFeedRow>[] = [
  {
    key: "at",
    label: "Time",
    kind: "instant",
    display: { type: "instant" },
    sortable: true,
    width: 116,
    filter: { type: "timerange", defaultOpen: true, commandDisabled: true },
  },
  {
    key: "actor",
    label: "Actor",
    kind: "string",
    width: 190,
    filter: { type: "checkbox" },
    // An audit row always has an actor, but not always an email: a system or
    // API actor has a label or an id instead. Falling back through them is the
    // difference between "who did this" and a column of dashes.
    cell: ({ row }) => {
      const name = row.actor ?? row.actorLabel;
      if (name) return <span className="block truncate">{name}</span>;
      return <CodeCell value={row.actorId} />;
    },
  },
  {
    key: "actorType",
    label: "Actor type",
    kind: "enum",
    display: { type: "badge" },
    width: 100,
    hidden: true,
    filter: { type: "checkbox" },
  },
  {
    key: "action",
    label: "Action",
    kind: "string",
    // Mono: an action is an RPC path, and it is what a reader copies into a
    // search when they go looking for the rest of them.
    display: { type: "code" },
    minWidth: 180,
    filter: { type: "checkbox" },
  },
  {
    key: "targetType",
    label: "Target",
    kind: "string",
    width: 110,
    filter: { type: "checkbox" },
  },
  {
    key: "targetId",
    label: "Target id",
    kind: "string",
    display: { type: "code" },
    minWidth: 150,
  },
  {
    key: "outcome",
    label: "Outcome",
    kind: "enum",
    display: { type: "state", tone: outcomeTone },
    width: 108,
    filter: { type: "checkbox", defaultOpen: true },
  },
  {
    key: "ip",
    label: "IP",
    kind: "string",
    display: { type: "code" },
    width: 128,
    hidden: true,
  },
  {
    key: "durationMs",
    label: "Duration",
    kind: "number",
    display: { type: "number", unit: "ms" },
    width: 92,
    hidden: true,
  },
  { key: "reason", label: "Reason", kind: "string", hidden: true },
  { key: "actorId", label: "Actor id", kind: "string", display: { type: "code" }, hidden: true },
  {
    key: "correlationId",
    label: "Correlation",
    kind: "string",
    display: { type: "code" },
    hidden: true,
  },
  {
    key: "userAgent",
    label: "User agent",
    kind: "string",
    hidden: true,
  },
  {
    key: "changes",
    label: "Changes",
    kind: "string",
    hidden: true,
    // A diff is unreadable in a 200px cell and essential in the sheet, so it
    // renders only there.
    sheet: {
      render: (row) =>
        row.changes ? (
          <pre className="overflow-x-auto rounded-md bg-muted/40 p-2 font-mono text-[11px]">
            {JSON.stringify(row.changes, null, 2)}
          </pre>
        ) : (
          <EmptyCell />
        ),
    },
  },
  {
    key: "target",
    label: "Target payload",
    kind: "string",
    hidden: true,
    sheet: {
      render: (row) =>
        row.target ? (
          <pre className="overflow-x-auto rounded-md bg-muted/40 p-2 font-mono text-[11px]">
            {JSON.stringify(row.target, null, 2)}
          </pre>
        ) : (
          <EmptyCell />
        ),
    },
  },
  {
    // The toolbar's search box. Declared here so its semantics sit beside every
    // other filter's, rendered nowhere as a column.
    key: "q",
    label: "Search",
    kind: "string",
    filterOnly: true,
    filter: {
      type: "search",
      keys: ["action", "actor", "actorId", "targetId", "reason"],
    },
  },
];
