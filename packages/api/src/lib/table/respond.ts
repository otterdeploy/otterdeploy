/**
 * The other half of every feed handler: turning a page into a response.
 *
 * A feed's own file should hold what is true of THAT feed — its scope, its row
 * shape, what its histogram is broken down by. Everything after that is the
 * same six steps in every one of them: skip the aggregates when the caller did
 * not ask, otherwise discover the range, bucket over the page's own predicates,
 * and assemble. Three copies of it was three places to get the `null` counts
 * wrong, and the duplication detector was right to say so.
 */

import type { Column, SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import type { Facets } from "./facets";
import type { FeedDatabase } from "./types";

import { computeHistogram, discoverRange } from "./histogram";

/** What `createFeedHandler().execute()` hands back, as this module reads it. */
interface ExecutedPage<TRow> {
  rows: TRow[];
  nextCursor: number | null;
  prevCursor: number | null;
  totalRowCount: number | null;
  filterRowCount: number | null;
  facets: Facets;
  where: readonly SQL[];
}

export interface FeedResponseOptions<TRow, TItem> {
  db: FeedDatabase;
  table: PgTable;
  /** The column the histogram buckets over — the feed's cursor column. */
  timeColumn: Column;
  /**
   * What each bucket is broken down by. An expression as well as a column: an
   * access log's bands are `2xx`…`5xx`, which is not a stored value.
   */
  categoryColumn?: Column | SQL;
  /** Whether this request asked for the counts, facets and histogram at all. */
  includeFacets: boolean;
  /** Row → the shape the contract sends. */
  toItem: (row: TRow) => TItem;
}

/**
 * One page, plus the aggregates that describe the whole filtered set.
 *
 * The histogram runs over the SAME predicates the page came from, so the bars
 * and the rows can never be describing two different queries.
 *
 * When the caller skipped the aggregates the counts come back `null` rather
 * than zero or a carried-over guess: this page did not ask, so it does not
 * know, and a guessed total is how a table stops halfway and looks finished.
 */
export async function feedResponse<TRow, TItem>(
  page: ExecutedPage<TRow>,
  options: FeedResponseOptions<TRow, TItem>,
) {
  const items = page.rows.map(options.toItem);

  if (!options.includeFacets) {
    return {
      items,
      nextCursor: page.nextCursor,
      prevCursor: page.prevCursor,
      totalRowCount: null,
      filterRowCount: null,
      facets: {} satisfies Facets,
    };
  }

  const { db, table, timeColumn, categoryColumn } = options;
  const range = await discoverRange({ db, table, column: timeColumn, where: page.where });
  const histogram = range
    ? await computeHistogram({
        db,
        table,
        timeColumn,
        ...(categoryColumn ? { categoryColumn } : {}),
        where: page.where,
        range,
      })
    : undefined;

  return {
    items,
    nextCursor: page.nextCursor,
    prevCursor: page.prevCursor,
    totalRowCount: page.totalRowCount,
    filterRowCount: page.filterRowCount,
    facets: page.facets,
    ...(histogram ? { histogram } : {}),
  };
}
