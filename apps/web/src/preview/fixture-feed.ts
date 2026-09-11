/**
 * A feed served from fixtures, for reviewing a table before its endpoint exists.
 *
 * This is not a mock. It plans filters through `defineFilters` and evaluates
 * them with `evaluateOp` — the same two functions the Postgres compiler is
 * built on — so a checkbox, a range or a search behaves here exactly as it will
 * once `createFeedHandler` is answering. Facets, the histogram and the cursor
 * walk are computed the same way the server computes them, which is what makes
 * the preview worth trusting: if a column reads badly here, it will read badly
 * in production, and that is the point of looking.
 *
 * Delete this directory when the last surface has a real feed.
 */

import type { FilterSpec } from "@otterdeploy/shared/table-filters";

import { defineFilters, evaluateOp, valueAtKey } from "@otterdeploy/shared/table-filters";

import type {
  Facet,
  Facets,
  FeedHistogram,
  FeedInput,
  FeedPage,
} from "@/shared/components/data-table/feed/types";

/** Buckets chosen so a window always draws 40-60 bars, as the server does. */
const TARGET_BUCKETS = 48;
const BUCKET_STEPS_MS = [
  1_000, 5_000, 15_000, 60_000, 300_000, 900_000, 3_600_000, 21_600_000, 43_200_000, 86_400_000,
  604_800_000,
];

function bucketSizeFor(spanMs: number): number {
  const ideal = spanMs / TARGET_BUCKETS;
  return BUCKET_STEPS_MS.find((step) => step >= ideal) ?? BUCKET_STEPS_MS.at(-1) ?? 86_400_000;
}

export interface FixtureFeedOptions<TRow> {
  rows: readonly TRow[];
  specs: readonly FilterSpec[];
  /** Epoch millis for a row — the sort key, the cursor and the histogram's x. */
  timeOf: (row: TRow) => number;
  /** The column the histogram stacks by, when its categories mean something. */
  categoryOf?: (row: TRow) => string;
  /** Keys that get a facet count. Usually every checkbox filter. */
  facetKeys?: readonly string[];
  /** Simulated round trip, so loading states are visible rather than theoretical. */
  latencyMs?: number;
}

/**
 * Newest first, which is the only order a log is read in.
 *
 * Ties break on the row's position in the fixture so paging can never repeat or
 * drop a row — the same reason the real feed carries a unique tiebreak.
 */
function sortNewestFirst<TRow>(
  rows: readonly TRow[],
  timeOf: (row: TRow) => number,
): { row: TRow; at: number; seq: number }[] {
  return rows
    .map((row, seq) => ({ row, at: timeOf(row), seq }))
    .sort((a, b) => b.at - a.at || b.seq - a.seq);
}

/**
 * Counts per option, each computed over a set its OWN filter did not narrow.
 *
 * Counting a checkbox facet after its own selection sends every unticked option
 * to zero, and an option at zero is dropped — so ticking one box empties the
 * list it lives in and the panel collapses under the pointer. Excluding the
 * key's own filter keeps the other options present, with the count they would
 * have if picked instead. Mirrors `computeFacets` on the server.
 */
function facetsOf<TRow>(
  rows: { row: TRow }[],
  facetKeys: readonly string[],
  matching: (excludeKey: string) => { row: TRow }[],
): Facets {
  const facets: Facets = {};
  for (const key of facetKeys) {
    const matched = matching(key);
    const counts = new Map<string, number>();
    for (const { row } of matched) {
      const raw = valueAtKey(row, key);
      // An array column faceted by its items: one row with three tags counts
      // once against each, which is what the sidebar's checkboxes mean.
      const values = Array.isArray(raw) ? raw : [raw];
      for (const value of values) {
        if (value === null || value === undefined) continue;
        const text = String(value);
        counts.set(text, (counts.get(text) ?? 0) + 1);
      }
    }
    const facet: Facet = {
      rows: [...counts]
        // Count first, then value: a stable order, so an option does not jump
        // up the list because the reader ticked a different one.
        .map(([value, total]) => ({ value, total }))
        .sort((a, b) => b.total - a.total || String(a.value).localeCompare(String(b.value))),
      total: matched.length,
    };
    facets[key] = facet;
  }
  return facets;
}

function histogramOf<TRow>(
  matched: { row: TRow; at: number }[],
  categoryOf: ((row: TRow) => string) | undefined,
): FeedHistogram | undefined {
  if (matched.length === 0) return undefined;
  const times = matched.map((entry) => entry.at);
  const min = Math.min(...times);
  const max = Math.max(...times);
  const bucketMs = bucketSizeFor(Math.max(max - min, 1));
  const floor = Math.floor(min / bucketMs) * bucketMs;

  const byBucket = new Map<number, { total: number; by: Record<string, number> }>();
  // Empty buckets are drawn, so seed every one across the span: a gap is
  // "nothing happened here", and a series that skips it invents activity.
  for (let at = floor; at <= max; at += bucketMs) byBucket.set(at, { total: 0, by: {} });
  for (const entry of matched) {
    const at = Math.floor(entry.at / bucketMs) * bucketMs;
    const bucket = byBucket.get(at) ?? { total: 0, by: {} };
    bucket.total += 1;
    if (categoryOf) {
      const category = categoryOf(entry.row);
      bucket.by[category] = (bucket.by[category] ?? 0) + 1;
    }
    byBucket.set(at, bucket);
  }

  return {
    bucketMs,
    buckets: [...byBucket]
      .sort((a, b) => a[0] - b[0])
      .map(([at, bucket]) => ({ at, total: bucket.total, by: bucket.by })),
  };
}

/**
 * The `fetchPage` a preview hands `<DataTable>`.
 *
 * Cursors are epoch millis, walked in both directions: `next` toward older rows
 * (scrolling down) and `prev` toward newer (what the live tail polls), which is
 * what lets the tail prepend arrivals instead of resetting the page.
 */
export function fixtureFeed<TRow>(options: FixtureFeedOptions<TRow>) {
  const { rows, specs, timeOf, categoryOf, facetKeys = [], latencyMs = 180 } = options;
  const filters = defineFilters(specs);
  const ordered = sortNewestFirst(rows, timeOf);

  return async (input: FeedInput): Promise<FeedPage<TRow>> => {
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));

    const ops = filters.plan(input.filters);
    const matched = ordered.filter((entry) => ops.every((op) => evaluateOp(op, entry.row)));
    /** The rows every filter BUT `key` allows — what that key's facet counts. */
    const matchingWithout = (key: string) => {
      const others = filters.plan(input.filters, { exclude: [key] });
      return ordered.filter((entry) => others.every((op) => evaluateOp(op, entry.row)));
    };

    const size = input.size ?? 50;
    const cursor = input.cursor ?? null;
    const direction = input.direction ?? "next";

    const window =
      cursor === null
        ? matched
        : direction === "next"
          ? matched.filter((entry) => entry.at < cursor)
          : matched.filter((entry) => entry.at > cursor);

    // Walking toward newer rows reads from the near end of the list, so take
    // from the tail and restore newest-first before returning.
    const page = direction === "next" ? window.slice(0, size) : window.slice(-size);
    const last = page.at(-1);
    const first = page[0];

    return {
      items: page.map((entry) => entry.row),
      nextCursor: last && window.length > page.length ? last.at : null,
      prevCursor: first ? first.at : null,
      // Aggregates only on the first page: they are identical for a fixed
      // filter set, and recomputing them per page is how a feed gets slow.
      totalRowCount: input.includeFacets === false ? null : ordered.length,
      filterRowCount: input.includeFacets === false ? null : matched.length,
      facets: input.includeFacets === false ? {} : facetsOf(matched, facetKeys, matchingWithout),
      histogram: input.includeFacets === false ? undefined : histogramOf(matched, categoryOf),
    };
  };
}
