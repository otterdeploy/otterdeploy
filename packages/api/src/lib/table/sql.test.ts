/**
 * The SQL half of the conformance pair.
 *
 * `packages/shared/src/table-filters/__tests__` pins what each declaration
 * MEANS; this file pins what that meaning compiles to. Read together they are
 * the guarantee that the rows on screen and the rows Postgres returns agree —
 * the numeric-checkbox case below is the one that used to differ.
 */

import { defineFilters, type FilterSpec } from "@otterdeploy/shared/table-filters";
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, test } from "vite-plus/test";

import type { ColumnMap } from "./sql";

import { allOf, buildWhere, toSql } from "./sql";

const events = pgTable("events", {
  id: text("id").primaryKey(),
  level: text("level").notNull(),
  status: integer("status").notNull(),
  host: text("host").notNull(),
  message: text("message"),
  latency: integer("latency").notNull(),
  tags: text("tags").array().notNull(),
  scores: integer("scores").array().notNull(),
  at: timestamp("at").notNull(),
});

const columns: ColumnMap = {
  level: events.level,
  status: events.status,
  host: events.host,
  message: events.message,
  latency: events.latency,
  tags: events.tags,
  scores: events.scores,
  at: events.at,
};

const specs: FilterSpec[] = [
  { key: "level", type: "checkbox", kind: "enum", options: ["debug", "info", "warn", "error"] },
  { key: "status", type: "checkbox", kind: "number", options: [200, 404, 500] },
  { key: "tags", type: "checkbox", kind: "array", itemKind: "string" },
  { key: "scores", type: "checkbox", kind: "array", itemKind: "number" },
  { key: "host", type: "input", kind: "string" },
  { key: "latency", type: "slider", kind: "number", min: 0, max: 5000 },
  { key: "at", type: "timerange", kind: "instant" },
  { key: "q", type: "search", kind: "string", keys: ["host", "message"] },
];

const filters = defineFilters(specs);
const dialect = new PgDialect();

/** Compile filter values the way a request would, into SQL text + params. */
function compile(values: Record<string, unknown>) {
  const where = allOf(buildWhere(filters, values, columns));
  if (!where) return { sql: "", params: [] };
  const query = dialect.sqlToQuery(where);
  return { sql: query.sql, params: query.params };
}

describe("values are bound, never spliced", () => {
  test("an equality operand is a parameter", () => {
    expect(compile({ level: ["error"] })).toEqual({
      sql: `"events"."level" in ($1)`,
      params: ["error"],
    });
  });

  test("a quote-breaking value cannot reach the statement", () => {
    const out = compile({ host: "' OR 1=1 --" });
    expect(out.sql).toBe(`"events"."host" ilike $1`);
    expect(out.sql).not.toContain("OR 1=1");
    expect(out.params).toEqual([`%' OR 1=1 --%`]);
  });

  test("LIKE metacharacters are escaped, so they match literally", () => {
    // The in-memory engine does a plain `includes`, which has no metacharacters
    // at all. Leaving these unescaped is exactly how the two would disagree
    // about what the user typed.
    expect(compile({ host: "100%_off" }).params).toEqual([String.raw`%100\%\_off%`]);
  });
});

describe("the declaration decides the operator", () => {
  test("a numeric checkbox is IN, never BETWEEN", () => {
    // The bug this exists to prevent: dispatching on the value's shape makes
    // `[200, 500]` look like a range, and `BETWEEN 200 AND 500` silently
    // matches 404 while the client-side filter does not.
    const out = compile({ status: [200, 500] });
    expect(out.sql).toBe(`"events"."status" in ($1, $2)`);
    expect(out.sql).not.toContain("between");
    expect(out.params).toEqual([200, 500]);
  });

  test("a slider on the same numbers is BETWEEN", () => {
    expect(compile({ latency: [200, 500] })).toEqual({
      sql: `"events"."latency" between $1 and $2`,
      params: [200, 500],
    });
  });

  test("checkbox members are bound in the column's declared type", () => {
    // Not `["200","500"]` leaning on Postgres to cast the literals.
    expect(compile({ status: ["200", "404"] }).params).toEqual([200, 404]);
  });

  test("a text box on a string column is a case-insensitive contains", () => {
    expect(compile({ host: "api" })).toEqual({
      sql: `"events"."host" ilike $1`,
      params: ["%api%"],
    });
  });
});

describe("array columns overlap", () => {
  test("a text array casts the literal to its own type", () => {
    const out = compile({ tags: ["deploy", "build"] });
    expect(out.sql).toBe(`"events"."tags" && ARRAY[$1, $2]::text[]`);
    expect(out.params).toEqual(["deploy", "build"]);
  });

  test("an integer array casts to integer[], not text[]", () => {
    // `&&` resolves no implicit casts: `integer[] && text[]` is a type error,
    // so a hardcoded `::text[]` fails at query time on every numeric array.
    expect(compile({ scores: [1, 2] }).sql).toBe(`"events"."scores" && ARRAY[$1, $2]::integer[]`);
  });
});

describe("time ranges", () => {
  test("a lone date becomes an inclusive whole-day range", () => {
    const out = compile({ at: ["2026-09-08"] });
    expect(out.sql).toBe(`(("events"."at" >= $1) and ("events"."at" <= $2))`);
    // Bound through the column's own driver mapping, so the value that reaches
    // Postgres is the instant the day started — not a locale-formatted string
    // whose meaning depends on the server's zone.
    expect(out.params).toEqual(["2026-09-08T00:00:00.000Z", "2026-09-08T23:59:59.999Z"]);
  });
});

describe("search spans columns", () => {
  test("every mapped column is OR-ed", () => {
    const out = compile({ q: "boom" });
    expect(out.sql).toBe(`(("events"."host" ilike $1) or ("events"."message" ilike $2))`);
    expect(out.params).toEqual(["%boom%", "%boom%"]);
  });

  test("an unmapped column is skipped, not widened to every row", () => {
    const wide = defineFilters([
      { key: "q", type: "search", kind: "string", keys: ["host", "nope"] },
    ]);
    const where = allOf(buildWhere(wide, { q: "boom" }, columns));
    expect(where).toBeDefined();
    if (!where) throw new Error("unreachable");
    expect(dialect.sqlToQuery(where).sql).toBe(`"events"."host" ilike $1`);
  });

  test("a search with no mapped column at all filters nothing", () => {
    const orphan = defineFilters([{ key: "q", type: "search", kind: "string", keys: ["nope"] }]);
    expect(buildWhere(orphan, { q: "boom" }, columns)).toEqual([]);
  });
});

describe("selection drives the three passes", () => {
  const values = { level: ["error"], latency: [100, 200], at: ["2026-09-08"] };

  test("pass 1 takes only the date keys", () => {
    const where = buildWhere(filters, values, columns, { only: ["at"] });
    expect(where).toHaveLength(1);
  });

  test("pass 2 excludes the sliders, so their own bounds do not collapse", () => {
    const where = allOf(buildWhere(filters, values, columns, { exclude: ["latency"] }));
    if (!where) throw new Error("unreachable");
    expect(dialect.sqlToQuery(where).sql).not.toContain("between");
  });

  test("pass 3 takes everything", () => {
    expect(buildWhere(filters, values, columns)).toHaveLength(3);
  });
});

describe("unknown and inactive input", () => {
  test("an unknown key never reaches SQL", () => {
    expect(buildWhere(filters, { dropTable: "x", level: [] }, columns)).toEqual([]);
  });

  test("a declared column with no mapping yields no predicate", () => {
    expect(toSql({ op: "equals", key: "missing", value: 1 }, columns)).toBeNull();
  });

  test("no filters at all is no WHERE clause", () => {
    expect(allOf([])).toBeUndefined();
  });
});
