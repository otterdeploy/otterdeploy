/**
 * The wire shape every server-paginated feed speaks.
 *
 * One shape for all of them, so the client's `<DataTable>` can drive a new
 * surface by being pointed at a new endpoint — and so adding one is a row
 * schema to write rather than a set of decisions to re-make. The client half
 * of this contract is `data-table/feed/types.ts`; they are the same object
 * described from both ends.
 */

import * as z from "zod";

/**
 * What the client sends.
 *
 * `filters` is an untyped bag on purpose. Its schema is the feed's own
 * DECLARATION — the `FilterSpec[]` the handler enforces through `coerce` —
 * which drops an unknown key, drops an enum member outside the declared set,
 * and clamps a numeric range to its bounds. Restating that as zod here would
 * be a second, weaker copy of the same rules, kept in agreement by hand.
 */
export const feedInput = z.object({
  filters: z.record(z.string(), z.unknown()).default({}),
  sort: z.object({ key: z.string(), desc: z.boolean() }).nullish(),
  /** Epoch millis of the last row on the previous page. */
  cursor: z.number().nullish(),
  direction: z.enum(["next", "prev"]).default("next"),
  size: z.number().int().min(1).max(200).default(50),
  /**
   * Counts, facets and the histogram. Skipped on pagination: they describe the
   * whole filtered set, so every page after the first would recompute the same
   * answer the client already holds.
   */
  includeFacets: z.boolean().default(true),
  /** Which day a lone date means. The client knows; the server must be told. */
  timeZone: z.string().optional(),
});

/** One filter key's facet: option counts, plus bounds for a numeric column. */
const facetSchema = z.object({
  rows: z.array(
    z.object({ value: z.union([z.string(), z.number(), z.boolean()]), total: z.number() }),
  ),
  total: z.number(),
  /** Distinct values overall, present only when `rows` was capped below it. */
  groups: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

const histogramSchema = z.object({
  buckets: z.array(
    z.object({
      at: z.number(),
      total: z.number(),
      by: z.record(z.string(), z.number()),
    }),
  ),
  bucketMs: z.number(),
});

/**
 * One page of rows, plus the aggregates that describe the whole filtered set.
 *
 * The row schema is the only thing a feed supplies, because it is the only
 * thing a feed knows that the others do not.
 */
export function feedOutput<TRow extends z.ZodTypeAny>(row: TRow) {
  return z.object({
    items: z.array(row),
    nextCursor: z.number().nullable(),
    prevCursor: z.number().nullable(),
    /** `null` when this page skipped the aggregates — never a stand-in guess. */
    totalRowCount: z.number().nullable(),
    filterRowCount: z.number().nullable(),
    facets: z.record(z.string(), facetSchema),
    histogram: histogramSchema.optional(),
  });
}
