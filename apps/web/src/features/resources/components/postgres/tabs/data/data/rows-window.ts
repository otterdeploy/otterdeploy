/**
 * A table's rows as a TanStack DB collection — the data lives on the CLIENT.
 *
 * One fetch pulls the table's first `WINDOW` rows into a collection; filters,
 * sorts and paging then run against that local window, so twisting a filter or
 * flipping a page costs zero round trips. This is the same shape the schema
 * already has (schema-collection.ts) and the pattern the app standardises on:
 * collections are the client data layer, queries are how they fill.
 *
 * Honesty rule: a table BIGGER than the window cannot be filtered truthfully
 * from a partial copy — a filter would silently miss rows the window never
 * held. `windowMetaFor(...).truncated` says so, and the browse hook falls back
 * to exact server-side filtering for those tables only.
 */
import type { CellValue, ColumnMeta, Filter, Sort } from "@otterdeploy/data-engine";

import { displayText, isFilterComplete } from "@otterdeploy/data-engine";
import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { orpc, queryClient } from "@/shared/server/orpc";

import type { TableRef } from "./queries";
import type { WorkbenchTarget } from "./target";

import { tableId } from "./schema-collection";
import { targetKey } from "./target";

/** Rows held client-side per table — the browse contract's own page cap. A
 * bigger ask is a BAD_REQUEST, which a collection swallows into an empty
 * grid; matching the cap keeps the window as large as the server allows. */
export const ROWS_WINDOW = 1000;

export interface RowsWindowRow {
  i: number;
  cells: CellValue[];
}

const collections = new Map<string, ReturnType<typeof buildCollection>>();

function windowKey(target: WorkbenchTarget, table: TableRef): string {
  return `${targetKey(target)}:${tableId(table.schema, table.name)}`;
}

function windowInput(target: WorkbenchTarget, table: TableRef) {
  return {
    target,
    schema: table.schema,
    table: table.name,
    columns: [],
    filters: [],
    sorts: [],
    limit: ROWS_WINDOW,
    offset: 0,
  };
}

function buildCollection(target: WorkbenchTarget, table: TableRef) {
  const key = windowKey(target, table);
  return createCollection(
    queryCollectionOptions({
      id: `data-rows:${key}`,
      queryKey: ["data-rows-window", key],
      queryFn: async (): Promise<RowsWindowRow[]> => {
        // WALL time of the whole request, measured where the user sits — not
        // the server's execute() slice. A chip that says 114ms while the
        // request took 350 is a lie; this number is what the wait felt like.
        // Parked in the query cache (a real singleton), not module state, and
        // not a row field: on a hydrated cache it is simply absent, never
        // wrong.
        const startedAt = performance.now();
        const grid = await orpc.data.browse.call(windowInput(target, table));
        queryClient.setQueryData(durationKey(key), Math.round(performance.now() - startedAt));
        return grid.rows.map((cells, i) => ({ i, cells }));
      },
      queryClient,
      getKey: (row) => row.i,
      staleTime: 30_000,
      retry: false,
    }),
  );
}

export function rowsWindowCollection(target: WorkbenchTarget, table: TableRef) {
  const key = windowKey(target, table);
  const existing = collections.get(key);
  if (existing) return existing;
  const created = buildCollection(target, table);
  collections.set(key, created);
  return created;
}

/** Drop the cache so the next read refetches — after a commit, or on ⟳. */
export function refetchRowsWindow(target: WorkbenchTarget, table: TableRef) {
  void queryClient.invalidateQueries({ queryKey: ["data-rows-window", windowKey(target, table)] });
}

/** Warm the window while the pointer is still over the rail row. */
export function prefetchRowsWindow(target: WorkbenchTarget, table: TableRef) {
  // Touching the collection is enough: creating it starts its first sync, and
  // an existing one is already warm or refreshing under its own staleTime.
  rowsWindowCollection(target, table);
}

/** A collection that is forever empty, for the hooks' no-table render. */
function durationKey(key: string) {
  return ["data-rows-duration", key];
}

/** Query-cache key of the window's fetch duration — subscribe with useQuery
 *  (`enabled: false`) so the value's ARRIVAL re-renders the reader; a passive
 *  `getQueryData` at render time misses the first fetch. */
export function windowDurationKey(target: WorkbenchTarget | null, table: TableRef | null) {
  return durationKey(target === null || table === null ? "none" : windowKey(target, table));
}

let empty: ReturnType<typeof buildEmpty> | null = null;
function buildEmpty() {
  return createCollection(
    queryCollectionOptions({
      id: "data-rows:none",
      queryKey: ["data-rows-window", "none"],
      queryFn: (): Promise<RowsWindowRow[]> => Promise.resolve([]),
      queryClient,
      getKey: (row: RowsWindowRow) => row.i,
      staleTime: Number.POSITIVE_INFINITY,
    }),
  );
}
export function emptyRowsCollection() {
  empty ??= buildEmpty();
  return empty;
}

// ── client-side view: filters → sorts → page ────────────────────────────────

export function applyRowsView(input: {
  rows: readonly RowsWindowRow[];
  columns: readonly ColumnMeta[];
  filters: readonly Filter[];
  sorts: readonly Sort[];
  limit: number;
  offset: number;
}): { page: CellValue[][]; matched: number } {
  const at = new Map(input.columns.map((c, i) => [c.name, i]));
  const active = input.filters.filter((f) => f.enabled && isFilterComplete(f) && at.has(f.column));

  let rows = input.rows;
  if (active.length > 0) {
    rows = rows.filter((r) => active.every((f) => matches(r.cells[at.get(f.column) ?? -1], f)));
  }
  if (input.sorts.length > 0) {
    rows = [...rows].sort((a, b) => {
      for (const s of input.sorts) {
        const i = at.get(s.column);
        if (i === undefined) continue;
        const d = compareCells(a.cells[i] ?? null, b.cells[i] ?? null);
        if (d !== 0) return s.direction === "desc" ? -d : d;
      }
      return a.i - b.i;
    });
  }
  return {
    page: rows.slice(input.offset, input.offset + input.limit).map((r) => r.cells),
    matched: rows.length,
  };
}

/** Cell vs typed operand: numeric when both sides are, ordinal otherwise —
 *  a lexicographic "9" > "10" on an int column would be a lie. */
function compareToOperand(cell: CellValue, operand: string): number {
  const nc = numeric(cell);
  const no = Number(operand);
  if (nc !== null && operand.trim() !== "" && Number.isFinite(no)) {
    return nc === no ? 0 : nc < no ? -1 : 1;
  }
  const text = displayText(cell);
  return text < operand ? -1 : text > operand ? 1 : 0;
}

/** NULLs sort last; numbers numerically when both sides are numeric. */
function compareCells(a: CellValue, b: CellValue): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  const na = numeric(a);
  const nb = numeric(b);
  if (na !== null && nb !== null) return na - nb;
  return displayText(a) < displayText(b) ? -1 : displayText(a) > displayText(b) ? 1 : 0;
}

function numeric(cell: CellValue): number | null {
  if (cell === null) return null;
  if (cell.k === "number") return cell.v;
  if (cell.k === "bigint" || cell.k === "decimal") {
    const n = Number(cell.v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Mirrors the server compiler's semantics (filters.ts): contains-family is
 *  case-insensitive, everything else exact/ordinal. */
function matches(cell: CellValue | undefined, f: Filter): boolean {
  const c = cell ?? null;
  if (f.op === "isnull") return c === null;
  if (f.op === "notnull") return c !== null;
  if (c === null) return false;
  return ORDINAL_OPS.has(f.op) ? ordinalMatches(c, f) : textMatches(displayText(c), f);
}

const ORDINAL_OPS = new Set<Filter["op"]>(["gt", "lt", "gte", "lte", "between"]);

function ordinalMatches(c: CellValue, f: Filter): boolean {
  const d = compareToOperand(c, f.values[0] ?? "");
  switch (f.op) {
    case "gt":
      return d > 0;
    case "lt":
      return d < 0;
    case "gte":
      return d >= 0;
    case "lte":
      return d <= 0;
    case "between":
      return d >= 0 && compareToOperand(c, f.values[1] ?? "") <= 0;
    default:
      return false;
  }
}

function textMatches(text: string, f: Filter): boolean {
  const lower = text.toLowerCase();
  const v0 = f.values[0] ?? "";
  switch (f.op) {
    case "eq":
      return text === v0;
    case "ne":
      return text !== v0;
    case "contains":
      return lower.includes(v0.toLowerCase());
    case "notcontains":
      return !lower.includes(v0.toLowerCase());
    case "startswith":
      return lower.startsWith(v0.toLowerCase());
    case "endswith":
      return lower.endsWith(v0.toLowerCase());
    case "in":
      return f.values.includes(text);
    case "notin":
      return !f.values.includes(text);
    default:
      return false;
  }
}
