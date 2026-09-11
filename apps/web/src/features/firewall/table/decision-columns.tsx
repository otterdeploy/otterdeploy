/**
 * The firewall decision feed's columns.
 *
 * SCOPE: this is the decisions half of the Firewall view only. Blocklists and
 * the active-bans panel are current STATE, not a feed — they answer "what is
 * enforced right now", which is a different question from "what has been
 * decided", and forcing them onto a log shell because they share a page would
 * make both worse. They keep their own surfaces.
 *
 * What this replaces: a shadcn `<Table>`, a second stacked-card layout below
 * `md` (which the shell already handles), `firewall-toolbar.tsx`,
 * `firewall-filters.tsx`, and the 15s poll behind a TanStack DB collection.
 *
 * The feed reads the PERSISTED `firewall_decision` table rather than the live
 * LAPI. CrowdSec deletes a decision when its duration runs out, so the LAPI can
 * only ever answer "what is banned now" — an operator looking an hour after an
 * SSH brute-force would see an empty table. The persisted rows are the memory
 * that makes this a log at all.
 *
 * What a reader scans, in order: is it still enforced, what kind, who, why.
 */

import type { DataTableColumn } from "@/shared/components/data-table/schema/types";

import {
  DecisionChip,
  DecisionCountry,
  DecisionStatus,
  decisionOriginTone,
  decisionState,
  type FirewallDecisionRow,
} from "@/features/firewall/table/decision-cells";
import { CLOCK_WIDTH, CodeCell, EmptyCell } from "@/shared/components/data-table/cells";

export const firewallDecisionColumns: readonly DataTableColumn<FirewallDecisionRow>[] = [
  {
    key: "firstSeenAt",
    label: "Seen",
    kind: "instant",
    display: { type: "clock" },
    sortable: true,
    width: CLOCK_WIDTH,
    filter: { type: "timerange", defaultOpen: true, commandDisabled: true },
  },
  {
    key: "status",
    label: "Status",
    kind: "string",
    width: 150,
    // State, kind and time remaining are one sentence — see `DecisionStatus`.
    cell: ({ row }) => <DecisionStatus row={row} />,
    sheet: false,
  },
  {
    key: "state",
    label: "State",
    kind: "enum",
    // FILTER only: the Status column already says active or expired, and a
    // second column repeating it in words would be the same fact twice.
    filterOnly: true,
    /**
     * Derived, and filterable — "show me the live bans" is the first question
     * anyone asks this page.
     *
     * The state is a reading of `endedAt`, not a stored value, so the feed maps
     * this key to an SQL expression rather than a column:
     *
     *   state: sql`case when ended_at is null then 'active' else 'expired' end`
     *
     * `ColumnMap` accepts either (see `packages/api/src/lib/table/sql.ts`). The
     * row carries the same value, so the client evaluator and the WHERE clause
     * still agree — which is the property the whole filter design rests on.
     */
    accessor: (row) => decisionState(row),
    filter: {
      type: "checkbox",
      defaultOpen: true,
      // Declared rather than faceted: both values always exist as CHOICES even
      // when a window happens to hold none of one, and "expired 0" is a more
      // useful thing to read than a missing row.
      options: [
        { label: "active", value: "active" },
        { label: "expired", value: "expired" },
      ],
    },
  },
  {
    key: "type",
    label: "Type",
    kind: "enum",
    // Also filter-only: the Status column prints the type, so a Type column is
    // the same word twice. The FACET is still worth having — "show me only the
    // captchas" is a real question.
    filterOnly: true,
    filter: { type: "checkbox", defaultOpen: true },
  },
  {
    key: "value",
    label: "Address",
    kind: "string",
    // Mono, and the widest of the identity columns: this is the string an
    // operator copies into a whois, a firewall rule, or the unblock box.
    display: { type: "code" },
    width: 150,
    filter: { type: "checkbox" },
  },
  {
    key: "scenario",
    label: "Scenario",
    kind: "string",
    // The single most useful column when reading history — it is the WHY, and
    // `crowdsecurity/ssh-slow-bf` is a thing you go and search for.
    display: { type: "code" },
    minWidth: 220,
    filter: { type: "checkbox" },
  },
  {
    key: "origin",
    label: "Origin",
    kind: "enum",
    width: 118,
    filter: { type: "checkbox", defaultOpen: true },
    // The difference between "someone is probing us" and "a blocklist synced".
    cell: ({ row }) => <DecisionChip value={row.origin} tone={decisionOriginTone(row.origin)} />,
  },
  {
    key: "country",
    label: "Country",
    kind: "enum",
    width: 78,
    filter: { type: "checkbox", optionLabel: (value) => <DecisionCountry code={String(value)} /> },
    cell: ({ row }) => (row.country ? <DecisionCountry code={row.country} /> : <EmptyCell />),
  },
  {
    key: "duration",
    label: "For",
    kind: "string",
    display: { type: "code" },
    width: 78,
    // Hidden: this is how long the ban was SET for, and Status already carries
    // how long is left — which is the one anybody acts on. Still here for the
    // reader asking "was this a 4h ban or a 7d one".
    hidden: true,
    cell: ({ row }) => (row.duration ? <CodeCell value={row.duration} /> : <EmptyCell />),
  },
  {
    key: "scope",
    label: "Scope",
    kind: "enum",
    display: { type: "badge" },
    width: 84,
    hidden: true,
    filter: { type: "checkbox" },
  },
  {
    key: "eventsCount",
    label: "Events",
    kind: "number",
    display: { type: "number" },
    width: 84,
    hidden: true,
    sortable: true,
    filter: { type: "slider", min: 0, max: 500 },
  },
  {
    key: "asName",
    label: "Network",
    kind: "string",
    width: 170,
    filter: { type: "checkbox" },
    // The ASN beside the operator's name: "OVH SAS" tells you who, "AS16276"
    // is what you put in a rule if you decide to block the whole range.
    cell: ({ row }) =>
      row.asName === null ? (
        <EmptyCell />
      ) : (
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate">{row.asName}</span>
          {row.asNumber ? (
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              AS{row.asNumber}
            </span>
          ) : null}
        </span>
      ),
  },
  {
    key: "lastSeenAt",
    label: "Last seen",
    kind: "instant",
    display: { type: "instant" },
    width: 116,
    hidden: true,
    sortable: true,
  },
  {
    key: "expiresAt",
    label: "Expires",
    kind: "instant",
    display: { type: "instant" },
    width: 116,
    hidden: true,
    sortable: true,
  },
  {
    key: "endedAt",
    label: "Ended",
    kind: "instant",
    display: { type: "instant" },
    width: 116,
    hidden: true,
    // The whole point of persisting decisions: "expired 20 minutes ago" is a
    // thing this page can say, and the live LAPI never could.
    cell: ({ row }) => (row.endedAt ? <span>{row.endedAt}</span> : <EmptyCell />),
    sheet: { label: "Ended" },
  },
  {
    key: "q",
    label: "Search",
    kind: "string",
    filterOnly: true,
    filter: { type: "search", keys: ["value", "scenario", "asName", "origin"] },
  },
];
