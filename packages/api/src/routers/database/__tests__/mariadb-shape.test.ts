import { describe, expect, test } from "vite-plus/test";

import {
  CLIENT_PROBE_SCRIPT,
  buildBrowseSql,
  buildPrimaryKeySql,
  buildTablesSql,
  parseBatch,
  parseEstimatedRows,
  pickClientPath,
  quoteIdent,
  shapeGrid,
  shapePrimaryKey,
  shapeTables,
  sqlString,
  unescapeCell,
} from "../mariadb-shape";

/** Build `mysql --batch` output from already-escaped cells. */
const batch = (...lines: string[][]) => lines.map((l) => l.join("\t")).join("\n") + "\n";

describe("pickClientPath", () => {
  test("takes the first path the probe printed", () => {
    // `command -v mariadb || command -v mysql` short-circuits, but a shell that
    // ran both would print both — prefer the first (mariadb).
    expect(pickClientPath("/usr/bin/mariadb\n")).toBe("/usr/bin/mariadb");
    expect(pickClientPath("/usr/bin/mariadb\n/usr/bin/mysql\n")).toBe("/usr/bin/mariadb");
  });

  test("mysql-only images (no mariadb symlink) resolve to mysql", () => {
    expect(pickClientPath("/usr/local/bin/mysql\n")).toBe("/usr/local/bin/mysql");
  });

  test("no client found", () => {
    expect(pickClientPath("")).toBeNull();
    expect(pickClientPath("\n  \n")).toBeNull();
  });

  test("probe prefers mariadb over mysql", () => {
    expect(CLIENT_PROBE_SCRIPT.indexOf("mariadb")).toBeLessThan(
      CLIENT_PROBE_SCRIPT.indexOf("command -v mysql"),
    );
  });
});

describe("quoteIdent / sqlString", () => {
  test("backticks are doubled", () => {
    expect(quoteIdent("users")).toBe("`users`");
    expect(quoteIdent("we`ird")).toBe("`we``ird`");
  });

  test("string literals escape both the quote and the backslash", () => {
    // MySQL/MariaDB treat `\` as an escape inside literals (unlike Postgres),
    // so doubling only the quote would let `\'` slip through.
    expect(sqlString("plain")).toBe("'plain'");
    expect(sqlString("O'Brien")).toBe("'O''Brien'");
    expect(sqlString("back\\slash")).toBe("'back\\\\slash'");
    expect(sqlString("\\'")).toBe("'\\\\'''");
  });
});

describe("unescapeCell", () => {
  test("\\N is SQL NULL, but only on its own", () => {
    expect(unescapeCell("\\N")).toBeNull();
    expect(unescapeCell("\\NN")).toBe("\\NN");
    expect(unescapeCell("")).toBe("");
  });

  test("control chars round-trip", () => {
    expect(unescapeCell("a\\tb")).toBe("a\tb");
    expect(unescapeCell("a\\nb")).toBe("a\nb");
    expect(unescapeCell("a\\\\b")).toBe("a\\b");
    expect(unescapeCell("a\\0b")).toBe("a\0b");
  });
});

describe("parseBatch", () => {
  test("header row carries the column names", () => {
    const out = batch(["id", "name"], ["1", "ada"], ["2", "grace"]);
    expect(parseBatch(out)).toEqual({
      columns: ["id", "name"],
      rows: [
        ["1", "ada"],
        ["2", "grace"],
      ],
    });
  });

  test("empty output", () => {
    expect(parseBatch("")).toEqual({ columns: [], rows: [] });
    expect(parseBatch("\n")).toEqual({ columns: [], rows: [] });
  });

  test("header-only result (matching table with zero rows)", () => {
    expect(parseBatch(batch(["id"]))).toEqual({ columns: ["id"], rows: [] });
  });

  test("splits on tab BEFORE unescaping, so embedded tabs don't add columns", () => {
    const out = batch(["id", "note"], ["1", "a\\tb"]);
    const { rows } = parseBatch(out);
    expect(rows[0]).toHaveLength(2);
    expect(unescapeCell(rows[0]?.[1] ?? "")).toBe("a\tb");
  });
});

describe("buildTablesSql", () => {
  test("asks for the row estimate and hides system schemas", () => {
    const sql = buildTablesSql();
    expect(sql).toContain("table_rows");
    expect(sql).toContain("'information_schema'");
    expect(sql).toContain("'performance_schema'");
    expect(sql).toContain("'mysql'");
    expect(sql).toContain("'sys'");
    expect(sql).toContain("table_type = 'BASE TABLE'");
    // Never a count(*) — that would full-scan every table on each page load.
    expect(sql).not.toContain("count(");
  });
});

describe("shapeTables", () => {
  test("parses schema, name and the row estimate", () => {
    const out = batch(
      ["table_schema", "table_name", "table_rows"],
      ["shop", "orders", "1024"],
      ["shop", "line_items", "0"],
    );
    expect(shapeTables(out)).toEqual([
      { schema: "shop", name: "orders", estimatedRows: 1024 },
      { schema: "shop", name: "line_items", estimatedRows: 0 },
    ]);
  });

  test("an engine that reports no estimate yields null, not 0", () => {
    const out = batch(["table_schema", "table_name", "table_rows"], ["shop", "cart", "\\N"]);
    expect(shapeTables(out)[0]?.estimatedRows).toBeNull();
  });

  test("no user tables", () => {
    expect(shapeTables(batch(["table_schema", "table_name", "table_rows"]))).toEqual([]);
  });
});

describe("parseEstimatedRows", () => {
  test("null and nonsense become unknown", () => {
    expect(parseEstimatedRows(null)).toBeNull();
    expect(parseEstimatedRows("-1")).toBeNull();
    expect(parseEstimatedRows("NULL")).toBeNull();
    expect(parseEstimatedRows("42")).toBe(42);
  });
});

describe("buildPrimaryKeySql", () => {
  test("targets the PRIMARY index in column order", () => {
    const sql = buildPrimaryKeySql("shop", "orders");
    expect(sql).toContain("table_schema = 'shop'");
    expect(sql).toContain("table_name = 'orders'");
    expect(sql).toContain("index_name = 'PRIMARY'");
    expect(sql).toContain("ORDER BY seq_in_index");
  });

  test("a quote-bearing table name stays inside its literal", () => {
    expect(buildPrimaryKeySql("shop", "o'rders")).toContain("table_name = 'o''rders'");
  });
});

describe("shapePrimaryKey", () => {
  test("composite keys keep index order", () => {
    const out = batch(["column_name"], ["order_id"], ["line_no"]);
    expect(shapePrimaryKey(out)).toEqual(["order_id", "line_no"]);
  });

  test("a table with no primary key yields no columns", () => {
    expect(shapePrimaryKey(batch(["column_name"]))).toEqual([]);
  });
});

describe("buildBrowseSql", () => {
  test("orders by the primary key so paging is stable", () => {
    expect(
      buildBrowseSql({ schema: "shop", table: "orders", pk: ["id"], limit: 100, offset: 200 }),
    ).toBe("SELECT * FROM `shop`.`orders` ORDER BY `id` LIMIT 101 OFFSET 200");
  });

  test("composite primary key", () => {
    expect(
      buildBrowseSql({
        schema: "shop",
        table: "line_items",
        pk: ["order_id", "line_no"],
        limit: 10,
        offset: 0,
      }),
    ).toBe("SELECT * FROM `shop`.`line_items` ORDER BY `order_id`, `line_no` LIMIT 11 OFFSET 0");
  });

  test("no primary key means no ORDER BY — we don't invent a key", () => {
    expect(buildBrowseSql({ schema: "shop", table: "audit", pk: [], limit: 50, offset: 0 })).toBe(
      "SELECT * FROM `shop`.`audit` LIMIT 51 OFFSET 0",
    );
  });

  test("fetches limit + 1 to detect the next page without a COUNT(*)", () => {
    const sql = buildBrowseSql({ schema: "s", table: "t", pk: [], limit: 1, offset: 0 });
    expect(sql).toContain("LIMIT 2");
  });

  test("identifiers are backtick-quoted, so a crafted name can't break out", () => {
    const sql = buildBrowseSql({
      schema: "s",
      table: "t` WHERE 1=1; DROP TABLE x; -- ",
      pk: [],
      limit: 1,
      offset: 0,
    });
    expect(sql).toBe("SELECT * FROM `s`.`t`` WHERE 1=1; DROP TABLE x; -- ` LIMIT 2 OFFSET 0");
  });
});

describe("shapeGrid", () => {
  test("trims the probe row and reports another page", () => {
    const out = batch(["id"], ["1"], ["2"], ["3"]);
    expect(shapeGrid(out, 2)).toEqual({
      columns: ["id"],
      rows: [["1"], ["2"]],
      hasMore: true,
    });
  });

  test("a full-but-final page is not hasMore", () => {
    const out = batch(["id"], ["1"], ["2"]);
    expect(shapeGrid(out, 2)).toEqual({
      columns: ["id"],
      rows: [["1"], ["2"]],
      hasMore: false,
    });
  });

  test("NULL cells survive as null, empty strings as empty strings", () => {
    const out = batch(["a", "b"], ["\\N", ""]);
    expect(shapeGrid(out, 10).rows).toEqual([[null, ""]]);
  });

  test("empty table keeps its columns", () => {
    expect(shapeGrid(batch(["id", "name"]), 10)).toEqual({
      columns: ["id", "name"],
      rows: [],
      hasMore: false,
    });
  });
});
