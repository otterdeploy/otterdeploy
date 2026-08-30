/**
 * Blocked: what CrowdSec is rejecting, and what it rejected.
 *
 * This is the merge of what used to be two tabs. "Enforcing now" read the LAPI
 * live; "History" read our recorder's table, which is the only place a ban
 * that has already expired still exists. To an operator those are one question
 * in two tenses, so they are now one tab with one range control — but still
 * two reads, because only the LAPI can say what is being enforced this second,
 * and only our table remembers what is gone. `../blocked-rows` normalises both into
 * one row shape, so the table below never has to know which one it got.
 */
import { useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { Table, TableBody, TableHeader, TableRow } from "@/shared/components/ui/table";

import type { BlockedRow } from "../blocked-rows";
import type { BlockedRange, BlockedState } from "../data";

import { blockedFields, liveRows, recordedRows } from "../blocked-rows";
import { decisionsQuery, historyQuery } from "../data";
import { filterRows } from "../search";
import { BLOCKED_COLUMNS, BlockedCard, BlockedTableRow } from "./blocked-rows-view";
import {
  CardSkeletonRows,
  EmptyCard,
  EmptyRow,
  HeadCells,
  TableSkeletonRows,
} from "./firewall-table";

/**
 * The rows behind the Blocked tab, plus the two numbers the chrome around it
 * needs: what the search narrowed away, and how many decisions are enforcing
 * right now (which is the tab's badge, and stays true at any range).
 *
 * `now` is the live LAPI read — the only thing that can say what is being
 * enforced this second. Every other range is our recorded table over that
 * window, returning both still-enforced and expired rows; the Status column
 * is what tells them apart.
 */
export function useBlockedRows(range: BlockedRange, state: BlockedState, search: string) {
  const isNow = range === "now";
  const live = useQuery(decisionsQuery());
  // Only fetched at the ranges that read it; the live poll is always on,
  // because the tab badge and the access log's ban markers both need it.
  // The window argument is inert while disabled, but has to stay a valid one
  // so the key doesn't churn on the way back to `now`.
  const recorded = useQuery({ ...historyQuery(isNow ? "7d" : range, "all"), enabled: !isNow });
  const source = isNow ? live : recorded;
  const rows = isNow ? liveRows(live.data ?? []) : recordedRows(recorded.data ?? []);

  // Search first, then state. Doing it in this order is what lets the state
  // filter's counts describe the set you are actually looking at: search
  // "cloudflare" and the chips say how many of THOSE are still enforcing.
  const searched = filterRows(rows, search, blockedFields);
  const enforcing = searched.reduce((n, r) => n + (r.enforcing ? 1 : 0), 0);

  return {
    rows: searched.filter((r) => stateMatches(r.enforcing, state)),
    total: rows.length,
    stateCounts: {
      all: searched.length,
      enforcing,
      expired: searched.length - enforcing,
    },
    loading: source.isLoading,
    liveCount: live.data?.length ?? 0,
  };
}

function stateMatches(enforcing: boolean, state: BlockedState): boolean {
  return state === "all" || (state === "enforcing") === enforcing;
}

export function BlockedPanel({
  rows,
  total,
  loading,
  range,
  state,
  searching,
  onUnblock,
  unblocking,
}: {
  rows: readonly BlockedRow[];
  /** Rows before the search box narrowed them, for the "n of m" footer. */
  total: number;
  /** First load, nothing cached. Distinct from "resolved and empty": this
   *  table must not claim nothing is blocked until it has been told. */
  loading: boolean;
  range: BlockedRange;
  state: BlockedState;
  searching: boolean;
  onUnblock: (ip: string) => void;
  unblocking: boolean;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const toggle = (row: BlockedRow) => setOpenKey((k) => (k === row.key ? null : row.key));
  const empty = emptyMessage(range, state, searching);

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {/* Stacked cards below md: eight columns in a 360px viewport is not a
          table, it is a horizontal scrollbar over the two columns nobody
          needed. Same pattern as the audit list. */}
      <div className="divide-y divide-border/60 md:hidden">
        {loading && rows.length === 0 ? (
          <CardSkeletonRows />
        ) : rows.length === 0 ? (
          <EmptyCard>{empty}</EmptyCard>
        ) : (
          rows.map((row) => (
            <BlockedCard
              key={row.key}
              row={row}
              open={openKey === row.key}
              onToggle={() => toggle(row)}
              onUnblock={onUnblock}
              unblocking={unblocking}
            />
          ))
        )}
      </div>

      <Table className="hidden md:table [&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
        <TableHeader>
          <TableRow className="border-b bg-muted/30 hover:bg-transparent">
            <HeadCells columns={BLOCKED_COLUMNS} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && rows.length === 0 ? (
            <TableSkeletonRows columns={BLOCKED_COLUMNS.length} />
          ) : rows.length === 0 ? (
            <EmptyRow columns={BLOCKED_COLUMNS.length}>{empty}</EmptyRow>
          ) : (
            rows.map((row) => (
              <BlockedTableRow
                key={row.key}
                row={row}
                open={openKey === row.key}
                onToggle={() => toggle(row)}
                onUnblock={onUnblock}
                unblocking={unblocking}
              />
            ))
          )}
        </TableBody>
      </Table>

      {/* The total is only interesting while a search is narrowing it. */}
      {searching && rows.length > 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          {rows.length} of {total}
        </p>
      ) : null}
    </div>
  );
}

function emptyMessage(range: BlockedRange, state: BlockedState, searching: boolean): string {
  if (searching) return "No decision matches that search.";
  // The state filter is the likelier cause of an empty table than the range,
  // so it gets to explain itself first — and at `now` it explains why there is
  // nothing to see rather than implying the record is missing.
  if (state === "expired") {
    return range === "now"
      ? "Nothing has expired in a live snapshot — everything here is being enforced right now. Pick a window to see decisions that have ended."
      : "No decision has ended in this window.";
  }
  if (state === "enforcing" && range !== "now") {
    return "Nothing recorded in this window is still being enforced.";
  }
  return range === "now"
    ? // Says where the past went, because an empty table here after an attack
      // is exactly when someone assumes the product forgot something.
      "Nothing is blocked right now. Bans expire on their own — pick a window to see the ones that have."
    : "No decision recorded in this window. Bans appear here as CrowdSec makes them, and stay after they expire.";
}
