/**
 * Cursor pagination that never loses a row.
 *
 * Offset pagination over a feed that is being written to (an audit log, a
 * deployment stream) drops and duplicates rows: every insert above the offset
 * shifts the window under the reader. Cursors are stable under concurrent
 * inserts and keep a constant cost at any depth.
 *
 * Two details make the difference between "cursors" and "correct cursors", and
 * both are here rather than in each caller:
 *
 * 1. **A unique tiebreak.** `ORDER BY timestamp DESC` leaves rows sharing a
 *    timestamp in whatever order the plan produced, and that order is not
 *    stable across queries — rows visibly shuffle between refetches.
 * 2. **A page boundary that falls BETWEEN cursor values.** The next page is
 *    fetched with a strict `<`, so any row sharing the last row's cursor value
 *    that did not fit would never be returned by any page. `snapPage` ends the
 *    page before such a group instead.
 */

import type { Column, SQL } from "drizzle-orm";

import { asc, desc, gt, lt } from "drizzle-orm";

/** Which way through the feed. `prev` walks toward newer rows (live tailing). */
export type FeedDirection = "next" | "prev";

export interface CursorPlan {
  /** The cursor predicate, or `undefined` for the first page. */
  condition: SQL | undefined;
  /** Cursor ordering, then the tiebreak. Nothing may follow the tiebreak. */
  orderBy: SQL[];
  /** A `prev` page is read ascending and must be reversed to display. */
  needsReverse: boolean;
}

/**
 * Build the cursor predicate and ordering.
 *
 * The tiebreak follows the cursor's own direction rather than being fixed, so a
 * `prev` page — fetched ascending and reversed afterwards — lands in the same
 * total order as the `next` pages around it.
 */
export function planCursor(params: {
  cursor: number | null;
  direction: FeedDirection;
  cursorColumn: Column;
  tiebreakColumn: Column;
  /** Sort chosen by the user, applied between cursor and tiebreak. */
  sort?: SQL;
}): CursorPlan {
  const { cursor, direction, cursorColumn, tiebreakColumn, sort } = params;
  // The driver seam: a `timestamp` column binds a `Date`.
  const at = cursor === null ? null : new Date(cursor);

  if (direction === "prev") {
    return {
      condition: at === null ? undefined : gt(cursorColumn, at),
      orderBy: [asc(cursorColumn), ...(sort ? [sort] : []), asc(tiebreakColumn)],
      needsReverse: true,
    };
  }

  return {
    condition: at === null ? undefined : lt(cursorColumn, at),
    orderBy: [desc(cursorColumn), ...(sort ? [sort] : []), desc(tiebreakColumn)],
    needsReverse: false,
  };
}

/** How many rows to ask for: one extra reveals whether the boundary splits a tie. */
export function overfetch(size: number): number {
  return size + 1;
}

export interface SnappedPage<TRow> {
  rows: TRow[];
  /**
   * The cursor value at the page boundary, when the query over-fetched.
   *
   * Only meaningful together with an EMPTY `rows`: that pair is the degenerate
   * case where one cursor value spans the whole page, and the caller has to
   * fetch that whole tied group to make any progress at all.
   */
  tiedAt: number | null;
}

/**
 * Cut an over-fetched result down to a page whose boundary falls between
 * distinct cursor values.
 *
 * `rows` must be the `size + 1` rows the query returned, in query order.
 * `cursorOf` reads a row's cursor value (epoch millis).
 */
export function snapPage<TRow>(
  rows: readonly TRow[],
  size: number,
  cursorOf: (row: TRow) => number | null,
): SnappedPage<TRow> {
  if (rows.length <= size) return { rows: [...rows], tiedAt: null };

  const overflow = rows[size];
  const boundary = overflow === undefined ? null : cursorOf(overflow);
  // A cursor value we cannot read cannot be compared, so leave the page as it is
  // rather than trimming rows on a guess.
  if (boundary === null) return { rows: rows.slice(0, size), tiedAt: null };

  const page = rows.slice(0, size);
  for (
    let last = page.at(-1);
    last !== undefined && cursorOf(last) === boundary;
    last = page.at(-1)
  ) {
    page.pop();
  }

  // An empty page here is the degenerate case: one cursor value spans the whole
  // page, so there is no boundary to retreat to. The caller reads `tiedAt` and
  // fetches the entire tied group, overflowing `size` — the only way to make
  // progress without dropping rows.
  return { rows: page, tiedAt: boundary };
}
