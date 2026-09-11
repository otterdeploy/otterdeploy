import { eq } from "drizzle-orm";
import { PgDialect, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { describe, expect, test } from "vite-plus/test";

import { bucketMsFor, buildBuckets, histogramStatement } from "./histogram";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

describe("bucketMsFor", () => {
  test("a window gets a width that keeps the bar count readable", () => {
    // Under 60 bars: more than that is a texture, fewer shows no shape.
    for (const span of [MINUTE, HOUR, 6 * HOUR, DAY, 7 * DAY, 90 * DAY]) {
      expect(span / bucketMsFor(span)).toBeLessThanOrEqual(60);
    }
  });

  test("an hour buckets by the minute", () => {
    expect(bucketMsFor(HOUR)).toBe(MINUTE);
  });

  test("a nonsense span still yields a usable width", () => {
    // Called with whatever the range discovery returned, including a range of
    // one row (span 0) or none at all.
    expect(bucketMsFor(0)).toBeGreaterThan(0);
    expect(bucketMsFor(-1)).toBeGreaterThan(0);
    expect(bucketMsFor(Number.NaN)).toBeGreaterThan(0);
  });
});

describe("buildBuckets", () => {
  const window = { anchorMs: 0, toMs: 4 * MINUTE, bucketMs: MINUTE };

  test("buckets nothing landed in are drawn, not skipped", () => {
    // The whole reason this is materialized: a gap is "nothing happened here",
    // and omitting it draws a run of activity that never existed.
    const buckets = buildBuckets([{ at: 2 * MINUTE, category: null, total: 3 }], window);
    expect(buckets.map((bucket) => bucket.at)).toEqual([
      0,
      MINUTE,
      2 * MINUTE,
      3 * MINUTE,
      4 * MINUTE,
    ]);
    expect(buckets.map((bucket) => bucket.total)).toEqual([0, 0, 3, 0, 0]);
  });

  test("categories fold into one bucket and total up", () => {
    const [bucket] = buildBuckets(
      [
        { at: 0, category: "success", total: 10 },
        { at: 0, category: "denied", total: 2 },
      ],
      window,
    );
    expect(bucket).toEqual({ at: 0, total: 12, by: { success: 10, denied: 2 } });
  });

  test("no category is no breakdown, not a category named null", () => {
    const [bucket] = buildBuckets([{ at: 0, category: null, total: 7 }], window);
    expect(bucket).toEqual({ at: 0, total: 7, by: {} });
  });

  test("the axis starts at the anchor, not at the first row", () => {
    // Two windows of the same width have to line up with each other, rather
    // than being offset by whenever the first row happened to arrive.
    const buckets = buildBuckets([{ at: 3 * MINUTE, category: null, total: 1 }], window);
    expect(buckets[0]?.at).toBe(0);
  });

  test("timestamps arrive as Dates, ISO strings or millis", () => {
    // Which one depends on the driver; all three are the same bucket.
    const rows = [
      { at: new Date(MINUTE), category: null, total: 1 },
      { at: new Date(MINUTE).toISOString(), category: null, total: 1 },
      { at: MINUTE, category: null, total: 1 },
    ];
    expect(buildBuckets(rows, window)[1]).toEqual({ at: MINUTE, total: 3, by: {} });
  });

  test("counts that came back as strings are still numbers", () => {
    // `COUNT(*)` can arrive as a string on a bigint-safe driver, and "3" + "4"
    // concatenating would be a silently wrong chart.
    const [bucket] = buildBuckets(
      [
        { at: 0, category: null, total: "3" },
        { at: 0, category: null, total: "4" },
      ],
      window,
    );
    expect(bucket?.total).toBe(7);
  });

  test("a row with an unreadable timestamp is dropped, not bucketed at zero", () => {
    const buckets = buildBuckets(
      [
        { at: null, category: null, total: 99 },
        { at: "not a time", category: null, total: 99 },
      ],
      window,
    );
    expect(buckets.every((bucket) => bucket.total === 0)).toBe(true);
  });
});

/**
 * A table whose own columns collide with the query's output names.
 *
 * Not contrived: `edge_event` really does store a `category`, which is what
 * broke the alias-based GROUP BY this pins.
 */
const collides = pgTable("collides", {
  at: timestamp("at").notNull(),
  ts: timestamp("ts").notNull(),
  category: text("category").notNull(),
  level: text("level").notNull(),
});

describe("histogramStatement", () => {
  const dialect = new PgDialect();
  const render = (statement: ReturnType<typeof histogramStatement>) =>
    dialect.sqlToQuery(statement).sql.replace(/\s+/g, " ");

  test("groups by ordinal, so a column named like an output cannot capture it", () => {
    // `GROUP BY at, category` binds to `collides.at` and `collides.category`,
    // not to the SELECT's aliases — silently bucketing by the wrong column on
    // the first, and failing outright on the second.
    const out = render(
      histogramStatement({
        table: collides,
        timeColumn: collides.ts,
        categoryColumn: collides.level,
        where: [],
        anchorMs: 0,
        bucketMs: 60_000,
      }),
    );
    expect(out).toContain("GROUP BY 1, 2");
    expect(out).toContain("ORDER BY 1 ASC");
    expect(out).not.toContain("GROUP BY at");
    expect(out).not.toContain('GROUP BY "at"');
  });

  test("no category column still yields a groupable second output", () => {
    const out = render(
      histogramStatement({
        table: collides,
        timeColumn: collides.ts,
        where: [],
        anchorMs: 0,
        bucketMs: 60_000,
      }),
    );
    expect(out).toContain("NULL::text AS category");
    expect(out).toContain("GROUP BY 1, 2");
  });

  test("the feed's predicates come through as the WHERE", () => {
    const out = render(
      histogramStatement({
        table: collides,
        timeColumn: collides.ts,
        categoryColumn: collides.level,
        where: [eq(collides.category, "cert")],
        anchorMs: 0,
        bucketMs: 60_000,
      }),
    );
    expect(out).toContain('WHERE "collides"."category" = $');
  });
});
