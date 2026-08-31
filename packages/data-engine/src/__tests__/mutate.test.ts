import { describe, expect, it } from "vite-plus/test";

import type { ColumnMeta } from "../types";

import { mysqlDialect, postgresDialect } from "../dialects";
import { buildMutation, isEditable } from "../mutate";

const col = (over: Partial<ColumnMeta> & { name: string }): ColumnMeta => ({
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
  ...over,
});

const COLUMNS: ColumnMeta[] = [
  col({ name: "id", kind: "bigint", isPrimaryKey: true, isGenerated: true, nullable: false }),
  col({ name: "status" }),
  col({ name: "note" }),
  col({ name: "total_cents", kind: "number" }),
];

const ctx = { dialect: postgresDialect, columns: COLUMNS };

describe("update", () => {
  it("targets exactly one row through the full primary key", () => {
    const out = buildMutation(
      {
        op: "update",
        schema: "public",
        table: "orders",
        pk: [{ column: "id", value: { k: "bigint", v: "8843" } }],
        set: [{ column: "status", value: { k: "text", v: "paid" } }],
      },
      ctx,
    );
    expect(out.isOk()).toBe(true);
    if (!out.isOk()) return;
    expect(out.value.sql).toBe(
      `UPDATE "public"."orders" SET "status" = $1 WHERE "id" = $2 RETURNING *`,
    );
    // Assignments bind before the key, so numbering matches send order.
    // Exact integers stay strings so no digit is lost on the way to the server.
    expect(out.value.params).toEqual(["paid", "8843"]);
  });

  it("writes SQL NULL, distinct from the empty string", () => {
    const out = buildMutation(
      {
        op: "update",
        schema: "",
        table: "orders",
        pk: [{ column: "id", value: { k: "bigint", v: "1" } }],
        set: [{ column: "note", value: null }],
      },
      ctx,
    );
    expect(out.isOk() && out.value.params[0]).toBeNull();
  });

  it("rejects a stale update by matching the original values", () => {
    const out = buildMutation(
      {
        op: "update",
        schema: "public",
        table: "orders",
        pk: [{ column: "id", value: { k: "bigint", v: "8843" } }],
        set: [
          { column: "status", value: { k: "text", v: "paid" } },
          { column: "note", value: { k: "text", v: "sent" } },
        ],
        expected: [
          { column: "status", value: { k: "text", v: "pending" } },
          { column: "note", value: null },
        ],
      },
      ctx,
    );
    expect(out.isOk()).toBe(true);
    if (!out.isOk()) return;
    expect(out.value.sql).toBe(
      `UPDATE "public"."orders" SET "status" = $1, "note" = $2 WHERE "id" = $3 AND "status" = $4 AND "note" IS NULL RETURNING *`,
    );
    expect(out.value.params).toEqual(["paid", "sent", "8843", "pending"]);
    expect(out.value.expectsAffectedRow).toBe(true);
  });

  it("refuses a table with no primary key rather than guessing with ctid", () => {
    const out = buildMutation(
      {
        op: "update",
        schema: "",
        table: "log",
        pk: [],
        set: [{ column: "status", value: { k: "text", v: "x" } }],
      },
      { dialect: postgresDialect, columns: [col({ name: "status" })] },
    );
    expect(out.isErr() && out.error.reason).toBe("no_primary_key");
  });

  it("refuses a partial composite key, which would widen the update", () => {
    const composite = [
      col({ name: "a", isPrimaryKey: true }),
      col({ name: "b", isPrimaryKey: true }),
      col({ name: "v" }),
    ];
    const out = buildMutation(
      {
        op: "update",
        schema: "",
        table: "t",
        pk: [{ column: "a", value: { k: "text", v: "1" } }],
        set: [{ column: "v", value: { k: "text", v: "x" } }],
      },
      { dialect: postgresDialect, columns: composite },
    );
    expect(out.isErr() && out.error.reason).toBe("incomplete_key");
    expect(out.isErr() && out.error.message).toContain("b");
  });

  it("refuses a null primary key rather than compiling IS NULL", () => {
    const out = buildMutation(
      {
        op: "update",
        schema: "",
        table: "orders",
        pk: [{ column: "id", value: null }],
        set: [{ column: "status", value: { k: "text", v: "x" } }],
      },
      ctx,
    );
    expect(out.isErr() && out.error.reason).toBe("incomplete_key");
  });

  it("rejects duplicate and non-key primary-key entries", () => {
    const duplicate = buildMutation(
      {
        op: "delete",
        schema: "",
        table: "orders",
        pk: [
          { column: "id", value: { k: "bigint", v: "1" } },
          { column: "id", value: { k: "bigint", v: "2" } },
        ],
        set: [],
      },
      ctx,
    );
    expect(duplicate.isErr() && duplicate.error.reason).toBe("duplicate_column");

    const extra = buildMutation(
      {
        op: "delete",
        schema: "",
        table: "orders",
        pk: [
          { column: "id", value: { k: "bigint", v: "1" } },
          { column: "status", value: { k: "text", v: "paid" } },
        ],
        set: [],
      },
      ctx,
    );
    expect(extra.isErr() && extra.error.reason).toBe("incomplete_key");
  });
});

describe("identifier allowlist", () => {
  it("rejects a column that is not on the table", () => {
    const out = buildMutation(
      {
        op: "update",
        schema: "",
        table: "orders",
        pk: [{ column: "id", value: { k: "bigint", v: "1" } }],
        set: [{ column: `x" = 1; DROP TABLE orders; --`, value: { k: "text", v: "y" } }],
      },
      ctx,
    );
    expect(out.isErr() && out.error.reason).toBe("unknown_column");
  });

  it("rejects writing a generated column instead of dropping it silently", () => {
    const out = buildMutation(
      {
        op: "insert",
        schema: "",
        table: "orders",
        pk: [],
        set: [{ column: "id", value: { k: "bigint", v: "5" } }],
      },
      ctx,
    );
    expect(out.isErr() && out.error.reason).toBe("generated_column");
  });
});

describe("insert and delete", () => {
  it("builds an insert over the assigned columns only", () => {
    const out = buildMutation(
      {
        op: "insert",
        schema: "public",
        table: "orders",
        pk: [],
        set: [
          { column: "status", value: { k: "text", v: "pending" } },
          { column: "total_cents", value: { k: "number", v: 4500 } },
        ],
      },
      ctx,
    );
    expect(out.isOk() && out.value.sql).toBe(
      `INSERT INTO "public"."orders" ("status", "total_cents") VALUES ($1, $2) RETURNING *`,
    );
  });

  it("refuses an insert with nothing to write", () => {
    const out = buildMutation({ op: "insert", schema: "", table: "orders", pk: [], set: [] }, ctx);
    expect(out.isErr() && out.error.reason).toBe("empty_assignment");
  });

  it("builds a key-guarded delete", () => {
    const out = buildMutation(
      {
        op: "delete",
        schema: "public",
        table: "orders",
        pk: [{ column: "id", value: { k: "bigint", v: "9" } }],
        set: [],
      },
      ctx,
    );
    expect(out.isOk() && out.value.sql).toBe(
      `DELETE FROM "public"."orders" WHERE "id" = $1 RETURNING *`,
    );
  });
});

describe("dialect differences", () => {
  it("omits RETURNING on mysql and says so", () => {
    const out = buildMutation(
      {
        op: "update",
        schema: "shop",
        table: "orders",
        pk: [{ column: "id", value: { k: "bigint", v: "1" } }],
        set: [{ column: "status", value: { k: "text", v: "paid" } }],
      },
      { dialect: mysqlDialect, columns: COLUMNS },
    );
    expect(out.isOk() && out.value.sql).toBe(
      "UPDATE `shop`.`orders` SET `status` = ? WHERE `id` = ?",
    );
    expect(out.isOk() && out.value.returnsRows).toBe(false);
  });
});

describe("isEditable", () => {
  it("is true only when a primary key exists", () => {
    expect(isEditable(COLUMNS)).toBe(true);
    expect(isEditable([col({ name: "a" })])).toBe(false);
  });
});
