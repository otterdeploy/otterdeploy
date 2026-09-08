/**
 * The search-param schema for a table, derived from its filter declarations.
 *
 * The route validates with this, so a hand-edited or stale URL degrades to "no
 * filter" instead of an error page — a URL is a convenience copy of state, not
 * an API. Every field is optional and every default is omitted, so a pristine
 * visit keeps a bare address and any touched control becomes shareable.
 */

import type { FilterSpec } from "@otterdeploy/shared/table-filters";

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
/** A range always carries both ends; one handle is written as `[n, n]`. */
const numberRange = z.tuple([z.number(), z.number()]);

/**
 * The value shape one declared filter accepts in the URL.
 *
 * Deliberately loose about the MEMBER type — `normalize` coerces members to the
 * column's declared family, and rejecting `"200"` for a numeric column here
 * would break every link that carries one.
 */
function fieldSchema(spec: FilterSpec): z.ZodType {
  switch (spec.type) {
    case "checkbox":
      // A single value is accepted and widened: `?level=error` is what a person
      // writes by hand, and what a "filter to just this" link produces.
      return z.union([z.array(scalar), scalar.transform((value) => [value])]);
    case "slider":
      return numberRange;
    case "timerange":
      return z.tuple([z.number(), z.number()]);
    case "input":
    case "search":
      return z.string();
  }
}

/**
 * Search params for a table: its filters, plus the four controls every table
 * shares.
 *
 * Spread into a route's own `validateSearch` object — a table lives on a page
 * that has its own params, and this must not claim the whole namespace.
 */
export function tableSearchSchema(specs: readonly FilterSpec[]) {
  const shape: Record<string, z.ZodType> = {
    /** `"key.desc"`. Absent means the feed's own order. */
    sort: z.string().regex(SORT_PATTERN).optional().catch(undefined),
    /** The row whose detail sheet is open — so a row is linkable too. */
    row: z.string().optional().catch(undefined),
    /** Tailing new rows. */
    live: z.boolean().optional().catch(undefined),
  };

  for (const spec of specs) {
    // `.catch` on every field: one malformed value must not take the page down
    // with it, and the rest of the filters still apply.
    shape[spec.key] = fieldSchema(spec).optional().catch(undefined);
  }

  return z.object(shape);
}

/** Filter values only — what the store holds and the request carries. */
export function filterValuesOf(
  search: Record<string, unknown>,
  specs: readonly FilterSpec[],
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const spec of specs) {
    const value = search[spec.key];
    if (value !== undefined) values[spec.key] = value;
  }
  return values;
}
