import { describe, expect, it } from "vite-plus/test";

import type { StructureColumn } from "./structure";

import { buildInsertSet, NULL_SENTINEL, validateInsertDraft } from "./insert";
import { parseStructureRows } from "./structure";

const col = (p: Partial<StructureColumn> & { name: string }): StructureColumn => ({
  dataType: "text",
  displayType: "text",
  nullable: true,
  default: null,
  isPrimaryKey: false,
  isUnique: false,
  fkRef: null,
  isAuto: false,
  isRequired: false,
  ...p,
});

const id = col({
  name: "id",
  dataType: "integer",
  displayType: "int",
  isAuto: true,
  isPrimaryKey: true,
  nullable: false,
});
const name = col({ name: "name", nullable: false, isRequired: true });
const bio = col({ name: "bio" });
const active = col({
  name: "active",
  dataType: "boolean",
  displayType: "boolean",
  nullable: false,
  default: "true",
});
const meta = col({ name: "meta", dataType: "jsonb", displayType: "jsonb" });
const score = col({ name: "score", dataType: "numeric", displayType: "numeric" });

const table = [id, name, bio, active, meta, score];

describe("buildInsertSet", () => {
  it("skips auto columns and empty fields, keeps typed values", () => {
    expect(buildInsertSet(table, { id: "9", name: "otter", bio: "" })).toEqual([
      { column: "name", value: "otter" },
    ]);
  });

  it("maps the NULL sentinel to SQL NULL", () => {
    expect(buildInsertSet(table, { name: "x", bio: NULL_SENTINEL })).toEqual([
      { column: "name", value: "x" },
      { column: "bio", value: null },
    ]);
  });

  it("sends everything else as text for server-side casting", () => {
    expect(buildInsertSet(table, { name: "x", score: "12.5", active: "false" })).toEqual([
      { column: "name", value: "x" },
      { column: "active", value: "false" },
      { column: "score", value: "12.5" },
    ]);
  });
});

describe("validateInsertDraft", () => {
  it("flags empty required columns (non-nullable, no default, not auto)", () => {
    expect(validateInsertDraft(table, {})).toEqual([{ column: "name", reason: "required" }]);
    // Defaulted non-nullable (active) and auto PK (id) are fine when empty.
    expect(validateInsertDraft(table, { name: "x" })).toEqual([]);
  });

  it("flags invalid JSON and invalid numbers", () => {
    expect(validateInsertDraft(table, { name: "x", meta: "{nope" })).toEqual([
      { column: "meta", reason: "invalid-json" },
    ]);
    expect(validateInsertDraft(table, { name: "x", score: "12,5" })).toEqual([
      { column: "score", reason: "invalid-number" },
    ]);
    expect(validateInsertDraft(table, { name: "x", meta: '{"a":1}', score: "12.5" })).toEqual([]);
  });

  it("accepts the NULL sentinel without type validation", () => {
    expect(validateInsertDraft(table, { name: "x", meta: NULL_SENTINEL })).toEqual([]);
  });
});

describe("parseStructureRows", () => {
  it("parses the introspection grid into structure columns", () => {
    const rows: (string | null)[][] = [
      // name, data_type, is_nullable, column_default, is_identity, is_pk, is_uq, ref_schema, ref_table, ref_column
      [
        "id",
        "integer",
        "NO",
        "nextval('users_id_seq'::regclass)",
        "NO",
        "t",
        "f",
        null,
        null,
        null,
      ],
      ["email", "character varying", "NO", null, "NO", "f", "t", null, null, null],
      ["org_id", "uuid", "YES", null, "NO", "f", "f", "public", "organization", "id"],
      ["created_at", "timestamp with time zone", "NO", "now()", "NO", "f", "f", null, null, null],
    ];
    const parsed = parseStructureRows(rows);
    expect(parsed).toHaveLength(4);

    expect(parsed[0]).toMatchObject({
      name: "id",
      isPrimaryKey: true,
      isAuto: true, // serial via nextval default
      isRequired: false,
    });
    expect(parsed[1]).toMatchObject({
      name: "email",
      displayType: "varchar",
      isUnique: true,
      isRequired: true, // NOT NULL, no default
    });
    expect(parsed[2]).toMatchObject({
      name: "org_id",
      nullable: true,
      fkRef: { schema: "public", table: "organization", column: "id" },
    });
    expect(parsed[3]).toMatchObject({
      name: "created_at",
      displayType: "timestamp",
      default: "now()",
      isRequired: false, // defaulted
    });
  });

  it("marks identity columns as auto", () => {
    const parsed = parseStructureRows([
      ["id", "bigint", "NO", null, "YES", "t", "f", null, null, null],
    ]);
    expect(parsed[0]).toMatchObject({ isAuto: true, isRequired: false });
  });

  it("skips rows with a missing column name", () => {
    expect(
      parseStructureRows([[null, "text", "YES", null, "NO", "f", "f", null, null, null]]),
    ).toEqual([]);
  });
});
