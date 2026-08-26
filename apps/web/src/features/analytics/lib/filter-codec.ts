/**
 * URL codec for the web-analytics filter bar: the `f` search param carries
 * `dim:op:value;dim:op:value`, values URI-encoded so `;` and `:` inside a
 * path or referrer can never split a segment. The vocabulary is the shared
 * one the oRPC contract builds its enums from, so a decoded filter is an
 * accepted filter by construction.
 */

import type { FilterDimension, FilterOp } from "@otterdeploy/shared/analytics-filters";

import { FILTER_DIMENSIONS, FILTER_OPS } from "@otterdeploy/shared/analytics-filters";
import { Result } from "better-result";

export interface WebAnalyticsFilter {
  dim: FilterDimension;
  op: FilterOp;
  value: string;
}

function isDimension(value: string): value is FilterDimension {
  return FILTER_DIMENSIONS.some((dim) => dim === value);
}

function isOp(value: string): value is FilterOp {
  return FILTER_OPS.some((op) => op === value);
}

/** Filters → the `f` param. Empty list → `undefined` so the param drops out
 *  of the URL entirely rather than lingering as `f=`. */
export function encodeFilters(filters: readonly WebAnalyticsFilter[]): string | undefined {
  if (filters.length === 0) return undefined;
  return filters.map((f) => `${f.dim}:${f.op}:${encodeURIComponent(f.value)}`).join(";");
}

/**
 * The `f` param → filters. Malformed segments are dropped, never guessed at:
 * a hand-edited URL yields the filters that parse and silently loses the
 * rest, which beats a crash or a filter the user never asked for.
 */
export function decodeFilters(encoded: string | undefined): WebAnalyticsFilter[] {
  if (encoded === undefined || encoded === "") return [];
  const filters: WebAnalyticsFilter[] = [];
  for (const segment of encoded.split(";")) {
    const parts = segment.split(":");
    if (parts.length !== 3) continue;
    const [dim, op, raw] = parts;
    if (!isDimension(dim) || !isOp(op)) continue;
    const value = Result.try(() => decodeURIComponent(raw)).unwrapOr(null);
    if (value === null || value.length === 0 || value.length > 512) continue;
    filters.push({ dim, op, value });
  }
  return filters;
}

/** Append-or-replace: one `is` filter per dimension keeps the bar readable;
 *  clicking a second row in the same card refines rather than stacks. */
export function withFilter(
  filters: readonly WebAnalyticsFilter[],
  next: WebAnalyticsFilter,
): WebAnalyticsFilter[] {
  const rest = filters.filter((f) => !(f.dim === next.dim && f.op === next.op));
  if (rest.length >= 20) return [...rest];
  return [...rest, next];
}

export function withoutFilter(
  filters: readonly WebAnalyticsFilter[],
  index: number,
): WebAnalyticsFilter[] {
  return filters.filter((_, i) => i !== index);
}
