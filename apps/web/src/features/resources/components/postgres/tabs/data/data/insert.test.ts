import type { CellKind, ColumnMeta } from "@otterdeploy/data-engine";

import { describe, expect, it } from "vite-plus/test";

import { buildInsertSet, NULL_SENTINEL, validateInsertDraft } from "./insert";
import { toStructureColumns } from "./structure";

/** One introspected column, defaulted to a plain nullable text field. */
const meta = (p: Partial<ColumnMeta> & { name: string }): ColumnMeta => ({
  dataType: "text",
  kind: "text",
  nullable: true,
  position: 1,
  defaultExpr: null,
  isPrimaryKey: false,
  isUnique: false,
  isGenerated: false,
  references: null,
  enumValues: null,
  comment: null,
  ...p,
});

const COLUMNS: ColumnMeta[] = [
  meta({
    name: "id",
    dataType: "integer",
    kind: "number",
    isGenerated: true,
    isPrimaryKey: true,
    nullable: false,
  }),
  meta({ name: "name", nullable: false }),
  meta({ name: "bio" }),
  meta({ name: "active", dataType: "boolean", kind: "bool", nullable: false, defaultExpr: "true" }),
  meta({ name: "meta", dataType: "jsonb", kind: "json" }),
  meta({ name: "score", dataType: "numeric", kind: "decimal" }),
];

const table = toStructureColumns(COLUMNS);
const kinds: Record<string, CellKind> = Object.fromEntries(COLUMNS.map((c) => [c.name, c.kind]));

describe("toStructureColumns", () => {
  it("derives the form model from introspected metadata", () => {
    // The predecessor read ten positional strings out of a `structureSql` grid
    // by index, with "t"/"YES" sentinels. There is nothing left to parse.
    const id = table[0];
    expect(id?.isAuto).toBe(true);
    expect(id?.isPrimaryKey).toBe(true);
    // Auto-generated ⇒ never required, even though it is NOT NULL with no default.
    expect(id?.isRequired).toBe(false);
  });

  it("requires a column only when nothing else will supply a value", () => {
    const byName = (n: string) => table.find((c) => c.name === n);
    expect(byName("name")?.isRequired).toBe(true); // NOT NULL, no default, not auto
    expect(byName("active")?.isRequired).toBe(false); // NOT NULL but defaulted
    expect(byName("bio")?.isRequired).toBe(false); // nullable
  });

  it("collapses the verbose engine type for the column label", () => {
    const [ts] = toStructureColumns([
      meta({ name: "created_at", dataType: "timestamp with time zone", kind: "instant" }),
    ]);
    expect(ts?.displayType).toBe("timestamp");
    expect(ts?.dataType).toBe("timestamp with time zone");
  });
});

describe("buildInsertSet", () => {
  it("skips auto columns and empty fields", () => {
    expect(buildInsertSet(table, kinds, { id: "9", name: "otter", bio: "" })).toEqual([
      { column: "name", value: { k: "text", v: "otter" } },
    ]);
  });

  it("maps the NULL sentinel to SQL NULL, distinct from the empty string", () => {
    // An omitted field takes the column's DEFAULT; the sentinel writes NULL.
    // The predecessor could express both, but its `null` and `""` reached the
    // server as the same thing once the value was stringified.
    expect(buildInsertSet(table, kinds, { name: "x", bio: NULL_SENTINEL })).toEqual([
      { column: "name", value: { k: "text", v: "x" } },
      { column: "bio", value: null },
    ]);
  });

  it("parses each value into the column's declared kind", () => {
    // Not "sent as text for the server to cast": a boolean is a boolean and a
    // numeric keeps its exact literal, so no digit is lost to a float.
    expect(buildInsertSet(table, kinds, { name: "x", score: "12.50", active: "false" })).toEqual([
      { column: "name", value: { k: "text", v: "x" } },
      { column: "active", value: { k: "bool", v: false } },
      { column: "score", value: { k: "decimal", v: "12.50" } },
    ]);
  });
});

describe("validateInsertDraft", () => {
  it("flags empty required columns (non-nullable, no default, not auto)", () => {
    expect(validateInsertDraft(table, kinds, {})).toEqual([{ column: "name", reason: "required" }]);
    expect(validateInsertDraft(table, kinds, { name: "x" })).toEqual([]);
  });

  it("flags invalid JSON and invalid numbers before they reach the database", () => {
    expect(validateInsertDraft(table, kinds, { name: "x", meta: "{nope" })).toEqual([
      { column: "meta", reason: "invalid-json" },
    ]);
    expect(validateInsertDraft(table, kinds, { name: "x", score: "12,5" })).toEqual([
      { column: "score", reason: "invalid-number" },
    ]);
    expect(
      validateInsertDraft(table, kinds, { name: "x", meta: '{"a":1}', score: "12.5" }),
    ).toEqual([]);
  });

  it("accepts the NULL sentinel without type validation", () => {
    expect(validateInsertDraft(table, kinds, { name: "x", meta: NULL_SENTINEL })).toEqual([]);
  });
});
