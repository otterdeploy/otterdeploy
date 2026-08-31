import { describe, expect, it } from "vite-plus/test";

import type { CellValue } from "../value";

import { cellValueSchema, displayText, editText, isNull, parseCell, toDriverParam } from "../value";

describe("null is distinguishable from the empty string", () => {
  // The single defect that motivated the whole rewrite: `psql --csv` printed
  // both as `""`, so the grid could not tell "no value" from "empty value".
  it("keeps them apart end to end", () => {
    const nul: CellValue = null;
    const empty: CellValue = { k: "text", v: "" };

    expect(isNull(nul)).toBe(true);
    expect(isNull(empty)).toBe(false);
    expect(toDriverParam(nul)).toBeNull();
    expect(toDriverParam(empty)).toBe("");
    expect(JSON.parse(JSON.stringify(nul))).toBeNull();
    expect(JSON.parse(JSON.stringify(empty))).toEqual({ k: "text", v: "" });
  });
});

describe("exact numerics survive the wire", () => {
  it("does not round an int8 past MAX_SAFE_INTEGER", () => {
    const id = "9007199254740993"; // 2^53 + 1
    const cell = parseCell(id, "bigint");
    expect(cell).toEqual({ k: "bigint", v: id });
    expect(displayText(cell ?? null)).toBe(id);
    // The old string-grid path is what this replaces; Number() loses the digit.
    expect(String(Number(id))).not.toBe(id);
  });

  it("keeps a numeric's trailing zeros", () => {
    expect(parseCell("10.50", "decimal")).toEqual({ k: "decimal", v: "10.50" });
  });

  it("rejects rather than coerces a malformed number", () => {
    expect(parseCell("12x", "number")).toBeUndefined();
    expect(parseCell("1.2.3", "decimal")).toBeUndefined();
    expect(parseCell("9.5", "bigint")).toBeUndefined();
  });
});

describe("parseCell", () => {
  it("accepts the boolean spellings a database actually returns", () => {
    for (const t of ["true", "TRUE", "t", "1", "yes"]) {
      expect(parseCell(t, "bool")).toEqual({ k: "bool", v: true });
    }
    for (const f of ["false", "F", "0", "no"]) {
      expect(parseCell(f, "bool")).toEqual({ k: "bool", v: false });
    }
    expect(parseCell("maybe", "bool")).toBeUndefined();
  });

  it("parses json into a real value, not a string", () => {
    expect(parseCell('{"a":[1,2]}', "json")).toEqual({ k: "json", v: { a: [1, 2] } });
    expect(parseCell("{not json", "json")).toBeUndefined();
  });

  it("validates dates and times structurally", () => {
    expect(parseCell("2026-08-31", "date")).toEqual({ k: "date", v: "2026-08-31" });
    expect(parseCell("31/08/2026", "date")).toBeUndefined();
    expect(parseCell("09:30:00", "time")).toEqual({ k: "time", v: "09:30:00" });
    expect(parseCell("9:30", "time")).toBeUndefined();
    expect(parseCell("2026-08-31T09:30:00", "datetime")).toEqual({
      k: "datetime",
      v: "2026-08-31T09:30:00",
    });
    expect(parseCell("2026-02-30T09:30:00", "datetime")).toBeUndefined();
    expect(parseCell("not-an-instant", "instant")).toBeUndefined();
  });

  it("treats empty text as an empty string, never as null", () => {
    expect(parseCell("", "text")).toEqual({ k: "text", v: "" });
  });
});

describe("displayText", () => {
  it("renders NULL as empty so it can never collide with the literal text", () => {
    // A column can genuinely contain the string "NULL"; the two must not look
    // the same, so the sentinel lives in the renderer, not in this function.
    expect(displayText(null)).toBe("");
    expect(displayText({ k: "text", v: "NULL" })).toBe("NULL");
  });

  it("summarises bytes rather than dumping base64 into a cell", () => {
    expect(displayText({ k: "bytes", v: "AAAA" })).toBe("\\x… 3 bytes");
  });

  it("renders arrays with postgres brace syntax", () => {
    expect(
      displayText({ k: "array", v: [{ k: "number", v: 1 }, null, { k: "text", v: "x" }] }),
    ).toBe("{1,,x}");
  });
});

describe("editText round-trips through parseCell", () => {
  it("keeps json lossless", () => {
    const cell: CellValue = { k: "json", v: { a: 1, b: [true, null] } };
    expect(parseCell(editText(cell), "json")).toEqual(cell);
  });

  it("keeps tagged array elements lossless", () => {
    const cell: CellValue = {
      k: "array",
      v: [{ k: "bigint", v: "9007199254740993" }, null, { k: "text", v: "1" }],
    };
    expect(parseCell(editText(cell), "array")).toEqual(cell);
  });
});

describe("cellValueSchema", () => {
  it("parses instead of trusting, including nested arrays", () => {
    const wire = { k: "array", v: [null, { k: "bigint", v: "12" }] };
    expect(cellValueSchema.parse(wire)).toEqual(wire);
  });

  it("rejects a shape that is not a cell", () => {
    expect(cellValueSchema.safeParse({ k: "text" }).success).toBe(false);
    expect(cellValueSchema.safeParse({ k: "nope", v: "x" }).success).toBe(false);
    expect(cellValueSchema.safeParse("bare string").success).toBe(false);
  });
});

describe("toDriverParam", () => {
  it("binds exact numerics as strings so the server does the conversion", () => {
    expect(toDriverParam({ k: "bigint", v: "9007199254740993" })).toBe("9007199254740993");
    expect(toDriverParam({ k: "decimal", v: "10.50" })).toBe("10.50");
  });

  it("decodes base64 to bytes", () => {
    const out = toDriverParam({ k: "bytes", v: "AQID" });
    expect(out).toBeInstanceOf(Uint8Array);
    expect([...(out instanceof Uint8Array ? out : new Uint8Array())]).toEqual([1, 2, 3]);
  });

  it("rejects malformed base64 before it reaches the driver", () => {
    expect(parseCell("a", "bytes")).toBeUndefined();
    expect(cellValueSchema.safeParse({ k: "bytes", v: "a" }).success).toBe(false);
  });

  it("binds arrays as driver arrays instead of lossy JSON strings", () => {
    expect(
      toDriverParam({ k: "array", v: [{ k: "number", v: 1 }, null, { k: "text", v: "1" }] }),
    ).toEqual([1, null, "1"]);
  });
});
