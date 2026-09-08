import { describe, expect, test } from "bun:test";

import type { FilterSpec } from "../index";

import { Temporal } from "../../temporal";
import { asInstant, defineFilters, evaluateOp, isActive, normalize } from "../index";

const LEVELS = ["debug", "info", "warn", "error"] as const;

const specs: FilterSpec[] = [
  { key: "level", type: "checkbox", kind: "enum", options: [...LEVELS] },
  { key: "status", type: "checkbox", kind: "number", options: [200, 404, 500] },
  { key: "tags", type: "checkbox", kind: "array", itemKind: "string" },
  { key: "host", type: "input", kind: "string" },
  { key: "port", type: "input", kind: "number" },
  { key: "latency", type: "slider", kind: "number", min: 0, max: 5000 },
  { key: "at", type: "timerange", kind: "instant" },
  { key: "q", type: "search", kind: "string", keys: ["host", "path", "actor.email"] },
];

const filters = defineFilters(specs);
const specOf = (key: string): FilterSpec => {
  const spec = specs.find((candidate) => candidate.key === key);
  if (!spec) throw new Error(`no spec for ${key}`);
  return spec;
};

const AT = (iso: string) => Temporal.Instant.from(iso);

describe("isActive", () => {
  test("absent, empty and unusable values are inactive", () => {
    expect(isActive(null)).toBe(false);
    expect(isActive(undefined)).toBe(false);
    expect(isActive("")).toBe(false);
    expect(isActive("   ")).toBe(false);
    expect(isActive([])).toBe(false);
    expect(isActive(Number.NaN)).toBe(false);
  });

  test("one usable member keeps an array active", () => {
    // The alternative deletes the whole filter when a single entry is blank,
    // and does it inconsistently: ["abc", 500] would survive and ["", 500] not.
    expect(isActive(["", 500])).toBe(true);
    expect(isActive(["", ""])).toBe(false);
  });

  test("false is a value, not an absence", () => {
    expect(isActive(false)).toBe(true);
    expect(isActive(0)).toBe(true);
  });
});

describe("normalize dispatches on the declaration, never the value shape", () => {
  test("a two-member numeric checkbox is a set, not a range", () => {
    expect(normalize(specOf("status"), [200, 500])).toEqual({
      op: "oneOf",
      key: "status",
      values: [200, 500],
    });
  });

  test("a two-handle slider on the same numbers is a range", () => {
    expect(normalize(specOf("latency"), [200, 500])).toEqual({
      op: "numberRange",
      key: "latency",
      min: 200,
      max: 500,
    });
  });

  test("checkbox members are coerced to the declared family", () => {
    // A URL can only carry strings; the SQL side must not depend on the
    // database casting "200" for an integer column.
    expect(normalize(specOf("status"), ["200", "404"])).toEqual({
      op: "oneOf",
      key: "status",
      values: [200, 404],
    });
  });

  test("an array column overlaps rather than matching membership", () => {
    expect(normalize(specOf("tags"), ["a", "b"])).toEqual({
      op: "overlaps",
      key: "tags",
      values: ["a", "b"],
    });
  });

  test("a text box on a number column is an exact match", () => {
    // Substring on a stringified number makes "5" match 1500.
    expect(normalize(specOf("port"), "5")).toEqual({ op: "equals", key: "port", value: 5 });
  });

  test("a text box on a string column is a substring", () => {
    expect(normalize(specOf("host"), " api ")).toEqual({
      op: "substring",
      key: "host",
      value: "api",
    });
  });

  test("a single slider handle is a degenerate range, not an equality", () => {
    expect(normalize(specOf("latency"), [250])).toEqual({
      op: "numberRange",
      key: "latency",
      min: 250,
      max: 250,
    });
  });

  test("reversed slider bounds are ordered", () => {
    expect(normalize(specOf("latency"), [500, 200])).toEqual({
      op: "numberRange",
      key: "latency",
      min: 200,
      max: 500,
    });
  });

  test("unusable members are dropped, not fatal", () => {
    expect(normalize(specOf("latency"), ["abc", 500])).toEqual({
      op: "numberRange",
      key: "latency",
      min: 500,
      max: 500,
    });
    expect(normalize(specOf("level"), ["warn", null, 42])).toEqual({
      op: "oneOf",
      key: "level",
      values: ["warn", "42"],
    });
  });

  test("a search spans its declared columns", () => {
    expect(normalize(specOf("q"), "boom")).toEqual({
      op: "substringAny",
      key: "q",
      keys: ["host", "path", "actor.email"],
      value: "boom",
    });
  });

  test("an inactive value never becomes an operation", () => {
    for (const spec of specs) {
      expect(normalize(spec, null)).toBeNull();
      expect(normalize(spec, [])).toBeNull();
      expect(normalize(spec, "")).toBeNull();
    }
  });
});

describe("timerange", () => {
  test("one date means that whole day in the declared zone", () => {
    const op = normalize(specOf("at"), ["2026-09-08"]);
    expect(op?.op).toBe("instantRange");
    if (op?.op !== "instantRange") throw new Error("unreachable");
    expect(op.from.toString()).toBe("2026-09-08T00:00:00Z");
    // Inclusive on both ends, without depending on the next day's first
    // nanosecond being excluded elsewhere.
    expect(op.to.epochMilliseconds).toBe(AT("2026-09-09T00:00:00Z").epochMilliseconds - 1);
  });

  test("the declared zone decides which day that is", () => {
    const zoned: FilterSpec = { ...specOf("at"), timeZone: "Asia/Tokyo" };
    const op = normalize(zoned, ["2026-09-08"]);
    if (op?.op !== "instantRange") throw new Error("unreachable");
    // Tokyo is UTC+9, so the day starts the previous evening in UTC.
    expect(op.from.toString()).toBe("2026-09-07T15:00:00Z");
  });

  test("reversed bounds are ordered", () => {
    const op = normalize(specOf("at"), [AT("2026-09-08T10:00:00Z"), AT("2026-09-08T09:00:00Z")]);
    if (op?.op !== "instantRange") throw new Error("unreachable");
    expect(op.from.toString()).toBe("2026-09-08T09:00:00Z");
    expect(op.to.toString()).toBe("2026-09-08T10:00:00Z");
  });

  test("epoch millis survive a round trip through a string", () => {
    const millis = AT("2026-09-08T09:00:00Z").epochMilliseconds;
    const op = normalize(specOf("at"), [String(millis), String(millis + 1000)]);
    if (op?.op !== "instantRange") throw new Error("unreachable");
    expect(op.from.epochMilliseconds).toBe(millis);
  });

  test("a malformed date is an inactive filter, never a throw", () => {
    expect(normalize(specOf("at"), ["not-a-date"])).toBeNull();
    expect(() => normalize(specOf("at"), ["not-a-date"])).not.toThrow();
  });

  test("asInstant reads every shape the wire produces", () => {
    const millis = AT("2026-09-08T09:00:00Z").epochMilliseconds;
    expect(asInstant(millis)?.epochMilliseconds).toBe(millis);
    expect(asInstant(new Date(millis))?.epochMilliseconds).toBe(millis);
    expect(asInstant("2026-09-08T09:00:00Z")?.epochMilliseconds).toBe(millis);
    expect(asInstant(AT("2026-09-08T09:00:00Z"))?.epochMilliseconds).toBe(millis);
    expect(asInstant("2024")).not.toBeNull();
    expect(asInstant("nope")).toBeNull();
    expect(asInstant(null)).toBeNull();
  });
});

describe("evaluateOp", () => {
  const row = {
    level: "warn",
    status: 404,
    tags: ["red", "blue"],
    host: "API.example.com",
    port: 5432,
    latency: 250,
    at: "2026-09-08T09:30:00Z",
    path: "/v1/deploy",
    actor: { email: "ada@example.com" },
    payload: { nested: "boom" },
  };

  const evalOne = (key: string, value: unknown) => {
    const op = normalize(specOf(key), value);
    return op === null ? null : evaluateOp(op, row);
  };

  test("substring is case-insensitive, matching SQL ilike", () => {
    expect(evalOne("host", "api")).toBe(true);
    expect(evalOne("host", "APi")).toBe(true);
    expect(evalOne("host", "nope")).toBe(false);
  });

  test("oneOf compares by string only as a last resort", () => {
    expect(evalOne("status", ["404"])).toBe(true);
    expect(evalOne("status", [200])).toBe(false);
    // The trap this avoids: `0 == false`.
    expect(evaluateOp({ op: "oneOf", key: "zero", values: [false] }, { zero: 0 })).toBe(false);
  });

  test("overlaps treats the column as a set", () => {
    expect(evalOne("tags", ["blue"])).toBe(true);
    expect(evalOne("tags", ["green"])).toBe(false);
    // A scalar cell is a one-element set, so a single-value column matches.
    expect(evaluateOp({ op: "overlaps", key: "tags", values: ["solo"] }, { tags: "solo" })).toBe(
      true,
    );
  });

  test("ranges are inclusive on both ends", () => {
    expect(evalOne("latency", [250, 250])).toBe(true);
    expect(evalOne("latency", [0, 249])).toBe(false);
    expect(evalOne("at", [AT("2026-09-08T09:30:00Z"), AT("2026-09-08T09:30:00Z")])).toBe(true);
  });

  test("search spans its declared columns, including a dotted one", () => {
    expect(evalOne("q", "deploy")).toBe(true);
    expect(evalOne("q", "ada@")).toBe(true);
    expect(evalOne("q", "API.exa")).toBe(true);
    // `payload` is not one of the declared search columns.
    expect(evalOne("q", "boom")).toBe(false);
  });

  test("a jsonb cell never matches a substring", () => {
    // `String({})` is "[object Object]"; a search that quietly matched every
    // row carrying a json column would be worse than one that matched none.
    expect(evaluateOp({ op: "substring", key: "payload", value: "object" }, row)).toBe(false);
  });

  test("a missing key never matches", () => {
    expect(evaluateOp({ op: "substring", key: "nothing", value: "x" }, row)).toBe(false);
    expect(evaluateOp({ op: "numberRange", key: "nothing", min: 0, max: 1 }, row)).toBe(false);
  });
});

describe("defineFilters", () => {
  const rows = [
    { id: "1", level: "error", status: 500, latency: 900, host: "api.example.com", tags: ["a"] },
    { id: "2", level: "warn", status: 404, latency: 120, host: "web.example.com", tags: ["b"] },
    { id: "3", level: "error", status: 200, latency: 40, host: "api.internal", tags: ["a", "c"] },
  ];

  test("plan drops unknown keys entirely", () => {
    // The value bag is untrusted input; iterating the specs means an unknown
    // key cannot reach an engine at all.
    const ops = filters.plan({ level: ["error"], dropTable: "x", unknown: [1, 2] });
    expect(ops).toHaveLength(1);
    expect(ops[0]?.key).toBe("level");
  });

  test("selection narrows the plan — the three-pass knob", () => {
    const values = { level: ["error"], latency: [0, 500], at: ["2026-09-08"] };
    expect(filters.plan(values, { only: ["at"] }).map((op) => op.key)).toEqual(["at"]);
    expect(filters.plan(values, { exclude: ["latency", "at"] }).map((op) => op.key)).toEqual([
      "level",
    ]);
  });

  test("apply AND-s every active filter", () => {
    expect(filters.apply(rows, { level: ["error"], latency: [0, 100] }).map((r) => r.id)).toEqual([
      "3",
    ]);
  });

  test("no active filter returns everything, as a copy", () => {
    const out = filters.apply(rows, { level: [] });
    expect(out).toHaveLength(3);
    expect(out).not.toBe(rows);
  });

  test("filterFn treats an empty column filter as matching everything", () => {
    const fn = filters.filterFn("level");
    if (!fn) throw new Error("expected a filterFn");
    const row = { getValue: () => "error", original: rows[0] };
    expect(fn(row, "level", [])).toBe(true);
    expect(fn(row, "level", ["error"])).toBe(true);
    expect(fn(row, "level", ["warn"])).toBe(false);
  });

  test("filterFn for a search reads the record, not one cell", () => {
    const fn = filters.filterFn("q");
    if (!fn) throw new Error("expected a filterFn");
    const row = { getValue: () => undefined, original: { host: "api.example.com" } };
    expect(fn(row, "q", "example")).toBe(true);
    expect(fn(row, "q", "nope")).toBe(false);
  });

  test("filterFn is undefined for an undeclared column", () => {
    expect(filters.filterFn("nope")).toBeUndefined();
  });
});

describe("coerce is the untrusted-input door", () => {
  test("members outside the declared option set are dropped", () => {
    expect(filters.coerce({ level: ["warn", "fatal"] })).toEqual({ level: ["warn"] });
    // Nothing survivable left means the filter is dropped, not emptied.
    expect(filters.coerce({ level: ["fatal"] })).toEqual({});
  });

  test("ranges are clamped to the declared bounds", () => {
    // An unbounded range is how a filter turns into a table scan.
    expect(filters.coerce({ latency: [-10, 99999] })).toEqual({ latency: [0, 5000] });
  });

  test("values are canonicalized, not passed through", () => {
    expect(filters.coerce({ status: ["200"], host: "  api  " })).toEqual({
      status: [200],
      host: "api",
    });
  });

  test("unknown keys never survive", () => {
    expect(filters.coerce({ nope: "x", "'; drop table": 1 })).toEqual({});
  });

  test("a timerange comes back as epoch millis, ready for a URL", () => {
    const coerced = filters.coerce({ at: ["2026-09-08"] });
    expect(coerced.at).toEqual([
      AT("2026-09-08T00:00:00Z").epochMilliseconds,
      AT("2026-09-09T00:00:00Z").epochMilliseconds - 1,
    ]);
  });
});
