import { describe, expect, test } from "vite-plus/test";

import { decodeFilters, encodeFilters, withFilter, withoutFilter } from "./filter-codec";

describe("filter codec", () => {
  test("round-trips a filter list, values included", () => {
    const filters = [
      { dim: "path", op: "is", value: "/pricing" },
      { dim: "referrer", op: "contains", value: "news.ycombinator.com" },
      { dim: "country", op: "isNot", value: "DE" },
    ] as const;
    expect(decodeFilters(encodeFilters([...filters]))).toEqual([...filters]);
  });

  test("round-trips values containing the delimiters themselves", () => {
    const filters = [
      { dim: "path", op: "is", value: "/a;b:c/d" },
      { dim: "referrer", op: "is", value: "Direct / none" },
      { dim: "event", op: "is", value: "(none)" },
    ] as const;
    expect(decodeFilters(encodeFilters([...filters]))).toEqual([...filters]);
  });

  test("empty list encodes to undefined so the param leaves the URL", () => {
    expect(encodeFilters([])).toBeUndefined();
    expect(decodeFilters(undefined)).toEqual([]);
    expect(decodeFilters("")).toEqual([]);
  });

  test("malformed input decodes to []", () => {
    expect(decodeFilters("garbage")).toEqual([]);
    expect(decodeFilters("path:is")).toEqual([]);
    expect(decodeFilters("nope:is:x")).toEqual([]);
    expect(decodeFilters("path:matches:x")).toEqual([]);
    // A broken percent-escape must not throw.
    expect(decodeFilters("path:is:%E0%A4%A")).toEqual([]);
  });

  test("keeps the valid segments of a partly malformed string", () => {
    expect(decodeFilters("path:is:%2Fdocs;bogus;country:is:DE")).toEqual([
      { dim: "path", op: "is", value: "/docs" },
      { dim: "country", op: "is", value: "DE" },
    ]);
  });

  test("drops empty and oversized values", () => {
    expect(decodeFilters("path:is:")).toEqual([]);
    expect(decodeFilters(`path:is:${"a".repeat(513)}`)).toEqual([]);
  });

  test("withFilter replaces a same-dimension same-op filter", () => {
    const base = [{ dim: "path", op: "is", value: "/a" }] as const;
    expect(withFilter([...base], { dim: "path", op: "is", value: "/b" })).toEqual([
      { dim: "path", op: "is", value: "/b" },
    ]);
    expect(withFilter([...base], { dim: "path", op: "contains", value: "b" })).toHaveLength(2);
  });

  test("withoutFilter removes by index", () => {
    const base = [
      { dim: "path", op: "is", value: "/a" },
      { dim: "country", op: "is", value: "DE" },
    ] as const;
    expect(withoutFilter([...base], 0)).toEqual([{ dim: "country", op: "is", value: "DE" }]);
  });
});
