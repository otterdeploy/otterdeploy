/**
 * The workbench's browse state as a URL, and back.
 *
 * The open table, its filters, sorts and page live in the search params so a
 * refresh lands exactly where you were — and so a filtered view of a table is
 * a LINK you can hand a teammate, which is the same reason `?target=` exists.
 *
 * Decoding is deliberately forgiving: a stale or hand-mangled param decodes to
 * its default instead of an error page, because the URL is a convenience copy
 * of state, not an API. Encoding omits defaults so the URL only says what
 * differs from a fresh visit.
 */
import type { Filter, Sort, TableRef } from "@otterdeploy/data-engine";

import { useEffect, useEffectEvent } from "react";

import { filterSchema, sortSchema } from "@otterdeploy/data-engine";
import { Result } from "better-result";
import * as z from "zod";

export interface WorkbenchUrlState {
  table: TableRef | null;
  filters: Filter[];
  sorts: Sort[];
  page: number;
  pageSize: number;
}

export const EMPTY_URL_STATE: WorkbenchUrlState = {
  table: null,
  filters: [],
  sorts: [],
  page: 0,
  pageSize: 100,
};

const filtersJson = z.array(filterSchema);
const sortsJson = z.array(sortSchema);

function parseJson<T>(schema: z.ZodType<T>, raw: string | undefined): T | null {
  if (raw === undefined) return null;
  const parsed = Result.try({ try: (): unknown => JSON.parse(raw), catch: () => null });
  if (parsed.isErr()) return null;
  const checked = schema.safeParse(parsed.value);
  return checked.success ? checked.data : null;
}

export interface WorkbenchSearch {
  table?: string;
  filters?: string;
  sorts?: string;
  page?: number;
  pageSize?: number;
}

export function urlStateFromSearch(s: WorkbenchSearch): WorkbenchUrlState {
  // `schema.name`, split on the FIRST dot; a bare name means the engine's
  // default schema ("" lets the server resolve it).
  const dot = s.table?.indexOf(".") ?? -1;
  const table =
    s.table === undefined
      ? null
      : dot === -1
        ? { schema: "", name: s.table }
        : { schema: s.table.slice(0, dot), name: s.table.slice(dot + 1) };
  return {
    table,
    filters: parseJson(filtersJson, s.filters) ?? [],
    sorts: parseJson(sortsJson, s.sorts) ?? [],
    page: s.page ?? EMPTY_URL_STATE.page,
    pageSize: s.pageSize ?? EMPTY_URL_STATE.pageSize,
  };
}

export function searchFromUrlState(state: WorkbenchUrlState): WorkbenchSearch {
  return {
    table:
      state.table === null
        ? undefined
        : state.table.schema === ""
          ? state.table.name
          : `${state.table.schema}.${state.table.name}`,
    filters: state.filters.length === 0 ? undefined : JSON.stringify(state.filters),
    sorts: state.sorts.length === 0 ? undefined : JSON.stringify(state.sorts),
    page: state.page === EMPTY_URL_STATE.page ? undefined : state.page,
    pageSize: state.pageSize === EMPTY_URL_STATE.pageSize ? undefined : state.pageSize,
  };
}

/**
 * Push the state to the URL whenever it CHANGES (keyed on the serialized
 * value, reached through an effect event so the route's fresh closure never
 * retriggers it).
 */
export function useWorkbenchUrlSync(
  state: WorkbenchUrlState,
  onUrlState: ((state: WorkbenchUrlState) => void) | undefined,
) {
  const push = useEffectEvent(() => onUrlState?.(state));
  const key = JSON.stringify(state);
  useEffect(() => {
    push();
  }, [key]);
}
