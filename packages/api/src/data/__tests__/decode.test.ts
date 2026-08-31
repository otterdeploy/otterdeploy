import { describe, expect, it } from "vite-plus/test";

import { decodeDeclared, decodeInferred, decodeRow } from "../decode";

describe("SQL NULL", () => {
  it("is the only thing that decodes to null, on both paths", () => {
    // The defect that motivated the rewrite: `psql --csv` printed NULL and ''
    // identically, so the grid could not tell "no value" from "empty value".
    expect(decodeDeclared(null, "text")).toBeNull();
    expect(decodeDeclared(undefined, "text")).toBeNull();
    expect(decodeInferred(null)).toBeNull();

    expect(decodeDeclared("", "text")).toEqual({ k: "text", v: "" });
    expect(decodeInferred("")).toEqual({ k: "text", v: "" });
  });

  it("survives a NULL in every declared family", () => {
    for (const kind of [
      "bool",
      "number",
      "bigint",
      "decimal",
      "bytes",
      "json",
      "instant",
      "date",
      "time",
      "array",
      "opaque",
    ] as const) {
      expect(decodeDeclared(null, kind)).toBeNull();
    }
  });
});

describe("exact numerics", () => {
  it("does not route int8 through Number", () => {
    expect(decodeDeclared("9007199254740993", "bigint")).toEqual({
      k: "bigint",
      v: "9007199254740993",
    });
    expect(decodeDeclared(9007199254740993n, "bigint")).toEqual({
      k: "bigint",
      v: "9007199254740993",
    });
  });

  it("keeps a numeric's trailing zeros", () => {
    expect(decodeDeclared("10.50", "decimal")).toEqual({ k: "decimal", v: "10.50" });
  });

  it("accepts float8 arriving as a string", () => {
    expect(decodeDeclared("1.5", "number")).toEqual({ k: "number", v: 1.5 });
    expect(decodeDeclared(1.5, "number")).toEqual({ k: "number", v: 1.5 });
  });
});

describe("structured types", () => {
  it("keeps jsonb a real value rather than a string the client re-parses", () => {
    expect(decodeDeclared({ a: [1, "x"], b: null }, "json")).toEqual({
      k: "json",
      v: { a: [1, "x"], b: null },
    });
  });

  it("base64-encodes bytea instead of stringifying it into mojibake", () => {
    expect(decodeDeclared(new Uint8Array([1, 2, 3]), "bytes")).toEqual({
      k: "bytes",
      v: "AQID",
    });
  });

  it("converts a driver Date to an ISO instant at the seam and no further", () => {
    // A Date here is a library seam. The repo's rule is Temporal everywhere;
    // an ISO instant is what Temporal parses, so it stops here.
    const d = new Date("2026-08-31T09:11:02.000Z");
    expect(decodeDeclared(d, "instant")).toEqual({
      k: "instant",
      v: "2026-08-31T09:11:02.000Z",
    });
    expect(decodeDeclared(d, "date")).toEqual({ k: "date", v: "2026-08-31" });
  });

  it("infers array elements rather than assuming one type for all of them", () => {
    // A text[] of digits must not become numbers.
    expect(decodeDeclared(["1", "2"], "array")).toEqual({
      k: "array",
      v: [
        { k: "text", v: "1" },
        { k: "text", v: "2" },
      ],
    });
    expect(decodeDeclared([1, null], "array")).toEqual({
      k: "array",
      v: [{ k: "number", v: 1 }, null],
    });
  });
});

describe("inference is deliberately conservative", () => {
  it("leaves a numeric-looking string as text", () => {
    // Without a declared type we only know the driver gave us a string. "1.5"
    // as a decimal and "1.5" as a version are the same characters; a grid that
    // right-aligns one because it matched a regex is lying about the database.
    expect(decodeInferred("1.5")).toEqual({ k: "text", v: "1.5" });
    expect(decodeInferred("9007199254740993")).toEqual({ k: "text", v: "9007199254740993" });
  });

  it("reads the families the driver genuinely distinguishes", () => {
    expect(decodeInferred(true)).toEqual({ k: "bool", v: true });
    expect(decodeInferred(42)).toEqual({ k: "number", v: 42 });
    expect(decodeInferred(1n)).toEqual({ k: "bigint", v: "1" });
    expect(decodeInferred({ a: 1 })).toEqual({ k: "json", v: { a: 1 } });
    expect(decodeInferred(new Uint8Array([255]))).toEqual({ k: "bytes", v: "/w==" });
  });
});

describe("unrepresentable values stay visible", () => {
  it("degrades an unencodable object to opaque rather than dropping it", () => {
    // A function is not JSON, so the object cannot round-trip as `json`.
    // It still has to be readable: "[object Object]" would defeat the point of
    // having an `opaque` kind at all.
    const weird = { fn: () => 1, keep: 2 };
    const out = decodeInferred(weird);
    expect(out).toEqual({ k: "opaque", v: '{"keep":2}' });
    expect(out).not.toEqual({ k: "opaque", v: "[object Object]" });
  });

  it("never renders an opaque cell as [object Object]", () => {
    // The whole reason `opaque` exists is to stay legible to a human working
    // out what the database returned, so its payload must always say something.
    // (A plain object is NOT opaque — it round-trips as `json` and keeps its
    // structure, which is the better outcome and is asserted above.)
    for (const value of [new Map([["a", 1]]), Symbol("s"), () => 1]) {
      const out = decodeInferred(value);
      expect(out).not.toBeNull();
      if (out === null || out.k !== "opaque") continue;
      expect(out.v).not.toBe("[object Object]");
      expect(out.v.length).toBeGreaterThan(0);
    }
  });

  it("marks a declared-opaque column opaque, not text", () => {
    expect(decodeDeclared("(1,2)", "opaque")).toEqual({ k: "opaque", v: "(1,2)" });
  });
});

describe("decodeRow", () => {
  it("uses declared kinds where it has them and infers past the end", () => {
    const row = decodeRow(["8843", null, "extra"], ["bigint", "text"]);
    expect(row).toEqual([{ k: "bigint", v: "8843" }, null, { k: "text", v: "extra" }]);
  });
});
