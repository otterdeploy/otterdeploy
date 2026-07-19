import { describe, expect, it } from "vite-plus/test";

import {
  buildWhere,
  type Filter,
  isFilterActive,
  isNumericOp,
  isValidNumericValue,
} from "./filters";

const filter = (p: Partial<Filter>): Filter => ({
  id: "f1",
  column: "",
  op: "",
  value: "",
  enabled: true,
  ...p,
});

describe("buildWhere — existing ops", () => {
  it("compiles equals with quoting and escaping", () => {
    expect(buildWhere([filter({ column: "name", op: "eq", value: "o'tter" })])).toBe(
      ` WHERE "name" = 'o''tter'`,
    );
  });

  it("compiles contains as ILIKE over ::text", () => {
    expect(buildWhere([filter({ column: "email", op: "contains", value: "aa" })])).toBe(
      ` WHERE "email"::text ILIKE '%aa%'`,
    );
  });

  it("ANDs multiple active filters and skips disabled ones", () => {
    const where = buildWhere([
      filter({ id: "a", column: "a", op: "isnull" }),
      filter({ id: "b", column: "b", op: "notnull", enabled: false }),
      filter({ id: "c", column: "c", op: "ne", value: "x" }),
    ]);
    expect(where).toBe(` WHERE "a" IS NULL AND "c" <> 'x'`);
  });
});

describe("buildWhere — numeric ops", () => {
  it("compiles >, <, >=, <= with unquoted numeric literals", () => {
    expect(buildWhere([filter({ column: "n", op: "gt", value: "10" })])).toBe(` WHERE "n" > 10`);
    expect(buildWhere([filter({ column: "n", op: "lt", value: "-1.5" })])).toBe(
      ` WHERE "n" < -1.5`,
    );
    expect(buildWhere([filter({ column: "n", op: "gte", value: "0" })])).toBe(` WHERE "n" >= 0`);
    expect(buildWhere([filter({ column: "n", op: "lte", value: "2e3" })])).toBe(
      ` WHERE "n" <= 2e3`,
    );
  });

  it("trims surrounding whitespace from the numeric literal", () => {
    expect(buildWhere([filter({ column: "n", op: "gt", value: " 42 " })])).toBe(` WHERE "n" > 42`);
  });

  it("never compiles a numeric op with a non-numeric value", () => {
    expect(buildWhere([filter({ column: "n", op: "gt", value: "abc" })])).toBe("");
    expect(buildWhere([filter({ column: "n", op: "lte", value: "1; DROP TABLE x" })])).toBe("");
    expect(buildWhere([filter({ column: "n", op: "gte", value: "1'1" })])).toBe("");
  });

  it("quotes the column identifier", () => {
    expect(buildWhere([filter({ column: 'we"ird', op: "gt", value: "1" })])).toBe(
      ` WHERE "we""ird" > 1`,
    );
  });
});

describe("isFilterActive", () => {
  it("requires a numeric value for numeric ops", () => {
    expect(isFilterActive(filter({ column: "n", op: "gt", value: "12.5" }))).toBe(true);
    expect(isFilterActive(filter({ column: "n", op: "gt", value: "12,5" }))).toBe(false);
    expect(isFilterActive(filter({ column: "n", op: "gt", value: "" }))).toBe(false);
  });

  it("keeps prior behavior for text ops and null checks", () => {
    expect(isFilterActive(filter({ column: "c", op: "contains", value: "x" }))).toBe(true);
    expect(isFilterActive(filter({ column: "c", op: "contains", value: "" }))).toBe(false);
    expect(isFilterActive(filter({ column: "c", op: "isnull" }))).toBe(true);
  });
});

describe("numeric helpers", () => {
  it("classifies the four ordering ops as numeric", () => {
    expect(isNumericOp("gt")).toBe(true);
    expect(isNumericOp("lt")).toBe(true);
    expect(isNumericOp("gte")).toBe(true);
    expect(isNumericOp("lte")).toBe(true);
    expect(isNumericOp("eq")).toBe(false);
    expect(isNumericOp("")).toBe(false);
  });

  it("accepts ints, decimals, negatives, and exponents; rejects junk", () => {
    for (const ok of ["0", "42", "-7", "3.14", ".5", "1e9", "2E-3", " 10 "]) {
      expect(isValidNumericValue(ok), ok).toBe(true);
    }
    for (const bad of ["", "abc", "1..2", "1e", "0x10", "1 or 1=1", "NaN", "Infinity"]) {
      expect(isValidNumericValue(bad), bad).toBe(false);
    }
  });
});
