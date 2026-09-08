/**
 * The wire shape every server-paginated table speaks.
 *
 * One shape, so one client hook can drive audit, deployments, edge logs and
 * everything after them — and so a new list endpoint is a contract to fill in
 * rather than a set of decisions to re-make.
 */

/** One filter key's facet: what each option would match, right now. */
export interface Facet {
  rows: { value: string | number | boolean; total: number }[];
  /** Rows the facet was computed over. */
  total: number;
  /** Bounds, for a numeric column. */
  min?: number;
  max?: number;
}

export type Facets = Record<string, Facet>;

/** One time bucket of the histogram, with its per-category breakdown. */
export interface HistogramBucket {
  /** Bucket start, epoch millis. */
  at: number;
  total: number;
  by: Record<string, number>;
}

export interface FeedHistogram {
  buckets: HistogramBucket[];
  bucketMs: number;
}

export interface FeedPage<TRow> {
  items: TRow[];
  /** Older rows. `null` at the end of the feed. */
  nextCursor: number | null;
  /** Newer rows — what live mode polls with. */
  prevCursor: number | null;
  /**
   * Rows in scope before filters, and rows matching the filters.
   *
   * `null` when this page skipped the aggregates (every page after the first).
   * Never a client-side stand-in: a guessed total is how a table stops halfway
   * and looks finished.
   */
  totalRowCount: number | null;
  filterRowCount: number | null;
  facets: Facets;
  histogram?: FeedHistogram;
}

/** What the client sends. Mirrors `FeedRequest` on the server. */
export interface FeedInput {
  filters: Record<string, unknown>;
  sort?: { key: string; desc: boolean } | null;
  cursor?: number | null;
  direction?: "next" | "prev";
  size?: number;
  /** Skipped on pagination: aggregates are identical for a fixed filter set. */
  includeFacets?: boolean;
}
