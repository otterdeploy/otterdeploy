import { describe, expect, it } from "vite-plus/test";

import type { Filter } from "../filters";

import { mysqlDialect, postgresDialect } from "../dialects";
import { buildSelect, columnLookup, compileFilters, orderByFragment } from "../filters";

const lookup = columnLookup([
  { name: "id", kind: "bigint" },
  { name: "status", kind: "text" },
  { name: "total_cents", kind: "number" },
  { name: "note", kind: "text" },
  { name: "created_at", kind: "instant" },
]);

const f = (over: Partial<Filter>): Filter => ({
  column: "status",
  op: "eq",
  values: ["paid"],
  enabled: true,
  ...over,
});

describe("values never enter the SQL string", () => {
  it("binds an equality operand as a parameter", () => {
    const out = compileFilters([f({})], postgresDialect, lookup);
    expect(out.sql).toBe(` WHERE "status" = $1`);
    // Driver-ready values, not CellValues: the conversion happens while the
    // fragment is built, so a caller cannot forget it.
    expect(out.params).toEqual(["paid"]);
  });

  it("neutralises a quote-breaking operand instead of escaping it", () => {
    // The predecessor spliced this in after doubling quotes. Here the operand
    // is never part of the statement, so there is nothing to escape.
    const out = compileFilters([f({ values: ["' OR 1=1 --"] })], postgresDialect, lookup);
    expect(out.sql).toBe(` WHERE "status" = $1`);
    expect(out.sql).not.toContain("OR 1=1");
    expect(out.params).toEqual(["' OR 1=1 --"]);
  });

  it("numbers placeholders across several filters", () => {
    const out = compileFilters(
      [f({}), f({ column: "total_cents", op: "gt", values: ["500"] })],
      postgresDialect,
      lookup,
    );
    expect(out.sql).toBe(` WHERE "status" = $1 AND "total_cents" > $2`);
    expect(out.params).toEqual(["paid", 500]);
  });
});

describe("identifiers are allowlisted, not escaped", () => {
  it("drops a filter naming a column the table does not have", () => {
    const out = compileFilters(
      [f({ column: 'x" ; DROP TABLE orders; --' })],
      postgresDialect,
      lookup,
    );
    expect(out.sql).toBe("");
    expect(out.params).toEqual([]);
  });
});

describe("LIKE operators", () => {
  it("escapes wildcards in user text so 50% is a literal", () => {
    const out = compileFilters(
      [f({ column: "note", op: "contains", values: ["50%"] })],
      postgresDialect,
      lookup,
    );
    expect(out.params).toEqual(["%50\\%%"]);
  });

  it("casts a non-text column before matching", () => {
    const out = compileFilters(
      [f({ column: "total_cents", op: "startswith", values: ["12"] })],
      postgresDialect,
      lookup,
    );
    expect(out.sql).toContain(`"total_cents"::text ILIKE $1`);
  });

  it("uses plain LIKE on mysql, whose collation is already insensitive", () => {
    const out = compileFilters(
      [f({ column: "note", op: "contains", values: ["x"] })],
      mysqlDialect,
      lookup,
    );
    expect(out.sql).toBe(" WHERE `note` LIKE ?");
  });
});

describe("arity", () => {
  it("emits no operand for isnull/notnull", () => {
    const out = compileFilters([f({ op: "isnull", values: [] })], postgresDialect, lookup);
    expect(out.sql).toBe(` WHERE "status" IS NULL`);
    expect(out.params).toEqual([]);
  });

  it("binds every operand of an IN list", () => {
    const out = compileFilters(
      [f({ op: "in", values: ["paid", "pending", "refunded"] })],
      postgresDialect,
      lookup,
    );
    expect(out.sql).toBe(` WHERE "status" IN ($1, $2, $3)`);
    expect(out.params).toHaveLength(3);
  });

  it("skips an incomplete filter rather than compiling half of it", () => {
    expect(compileFilters([f({ op: "between", values: ["1"] })], postgresDialect, lookup).sql).toBe(
      "",
    );
    expect(compileFilters([f({ values: [""] })], postgresDialect, lookup).sql).toBe("");
    expect(compileFilters([f({ enabled: false })], postgresDialect, lookup).sql).toBe("");
    expect(compileFilters([f({ op: "in", values: [] })], postgresDialect, lookup).sql).toBe("");
  });
});

describe("sorting", () => {
  const order = (d: typeof postgresDialect, sorts: Parameters<typeof orderByFragment>[0]) => {
    const frag = orderByFragment(sorts, d, lookup);
    return frag === null ? "" : d.compiler().sqlToQuery(frag).sql;
  };

  it("uses native NULLS placement on postgres", () => {
    expect(
      order(postgresDialect, [{ column: "created_at", direction: "desc", nulls: "last" }]),
    ).toBe(` ORDER BY "created_at" DESC NULLS LAST`);
  });

  it("emulates NULLS placement portably on mysql", () => {
    // Native NULLS LAST needs MySQL 8.0.31+; ISNULL() works everywhere.
    expect(order(mysqlDialect, [{ column: "created_at", direction: "desc", nulls: "last" }])).toBe(
      " ORDER BY ISNULL(`created_at`) ASC, `created_at` DESC",
    );
  });

  it("drops a sort naming a column the table does not have", () => {
    expect(order(postgresDialect, [{ column: "nope", direction: "asc", nulls: null }])).toBe("");
  });
});

describe("buildSelect", () => {
  it("fetches one extra row so truncation is knowable without a second count", () => {
    const out = buildSelect({
      dialect: postgresDialect,
      schema: "public",
      table: "orders",
      columns: ["id", "status"],
      filters: [f({})],
      sorts: [{ column: "id", direction: "desc", nulls: null }],
      limit: 100,
      offset: 200,
      lookup,
    });
    expect(out.sql).toBe(
      `SELECT "id", "status" FROM "public"."orders" WHERE "status" = $1 ORDER BY "id" DESC LIMIT 101 OFFSET 200`,
    );
  });

  it("quotes a schema-qualified target and survives a reserved word", () => {
    const out = buildSelect({
      dialect: postgresDialect,
      schema: "billing",
      table: "order",
      columns: [],
      filters: [],
      sorts: [],
      limit: 10,
      offset: 0,
      lookup,
    });
    expect(out.sql).toContain(`FROM "billing"."order"`);
  });
});
