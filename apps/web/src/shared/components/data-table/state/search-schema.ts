/**
 * A table's search params: the three controls every table shares, plus its
 * filter values.
 *
 * The filter values are deliberately NOT re-validated by a zod shape here. They
 * already have a validator — `filters.coerce`, the same one the server runs —
 * which drops unknown keys, checks enum members against the declared set and
 * clamps numeric ranges to their bounds. A second, weaker copy of those rules
 * expressed as zod would be one more thing to keep in agreement with the first.
 *
 * So the route validates the controls and passes the rest through, and the
 * store takes what `coerce` accepts. A hand-edited or stale URL degrades to "no
 * filter" rather than an error page — a URL is a convenience copy of state, not
 * an API.
 */

import { defineFilters, type FilterSpec } from "@otterdeploy/shared/table-filters";
import * as z from "zod";

/** `"at.desc"` — compact enough to read in an address bar. */
const SORT_PATTERN = /^[\w.]+\.(asc|desc)$/;

export interface TableSort {
  key: string;
  desc: boolean;
}

export function parseSort(value: string | undefined): TableSort | null {
  if (!value || !SORT_PATTERN.test(value)) return null;
  const separator = value.lastIndexOf(".");
  const key = value.slice(0, separator);
  return key === "" ? null : { key, desc: value.slice(separator + 1) === "desc" };
}

export function serializeSort(sort: TableSort | null): string | undefined {
  return sort ? `${sort.key}.${sort.desc ? "desc" : "asc"}` : undefined;
}

const scalar = z.union([z.string(), z.number(), z.boolean()]);

/**
 * The URL shape of each filter type.
 *
 * Shape only — what a value may LOOK like in an address bar. What it MEANS is
 * `coerce`'s business, which is why these are permissive: rejecting `?level=x`
 * here would take the page down over one stale link, and dropping it there is
 * the same outcome without the error page.
 */
export const filterParam = {
  /** A multi-select. A bare value is accepted and widened: `?outcome=denied`. */
  checkbox: () =>
    z
      .union([z.array(scalar), scalar.transform((value) => [value])])
      .optional()
      .catch(undefined),
  /** A text box. */
  text: () => z.string().optional().catch(undefined),
  /** `[from, to]`, epoch millis. */
  timerange: () => z.tuple([z.number(), z.number()]).optional().catch(undefined),
  /** `[min, max]`. One handle is written as `[n, n]`. */
  range: () => z.tuple([z.number(), z.number()]).optional().catch(undefined),
};

/**
 * Search params for a table: the three shared controls, plus this table's
 * filter params.
 *
 * The filter shape is passed in rather than derived from the specs because a
 * derived shape erases its keys — the schema becomes an index signature, and
 * TanStack Router merges route search types, so ONE such route makes `navigate`
 * untyped everywhere else in the app. Written out, every key stays known.
 */
export function tableSearchSchema<TFilters extends z.ZodRawShape>(filters: TFilters) {
  return z.object({
    /** `"key.desc"`. Absent means the feed's own order. */
    sort: z.string().regex(SORT_PATTERN).optional().catch(undefined),
    /** The row whose detail sheet is open — so a row is linkable too. */
    row: z.string().optional().catch(undefined),
    /** Tailing new rows. */
    live: z.boolean().optional().catch(undefined),
    ...filters,
  });
}

/**
 * The filter values in a search bag, validated against the declaration.
 *
 * This is the one validator: an unknown key never survives it, an enum member
 * outside the declared option set is dropped, and a numeric range is clamped to
 * its declared bounds. It is the same function the server calls on the same
 * declarations, so the client cannot ask for something the server would refuse
 * to compile.
 */
export function filterValuesOf(
  search: Record<string, unknown>,
  specs: readonly FilterSpec[],
): Record<string, unknown> {
  return defineFilters(specs).coerce(search);
}
