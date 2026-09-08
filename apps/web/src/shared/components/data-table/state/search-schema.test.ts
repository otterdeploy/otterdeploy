import type { FilterSpec } from "@otterdeploy/shared/table-filters";

import { describe, expect, test } from "vite-plus/test";

import { canLoadMore } from "../feed/use-feed";
import {
  filterParam,
  filterValuesOf,
  parseSort,
  serializeSort,
  tableSearchSchema,
} from "./search-schema";

const specs: FilterSpec[] = [
  { key: "outcome", type: "checkbox", kind: "enum", options: ["success", "failure", "denied"] },
  { key: "latency", type: "slider", kind: "number", min: 0, max: 5000 },
  { key: "at", type: "timerange", kind: "instant" },
  { key: "q", type: "search", kind: "string", keys: ["action"] },
];

describe("sort round trip", () => {
  test("a sort survives serialize → parse", () => {
    expect(parseSort(serializeSort({ key: "at", desc: true }))).toEqual({ key: "at", desc: true });
    expect(parseSort(serializeSort({ key: "at", desc: false }))).toEqual({
      key: "at",
      desc: false,
    });
  });

  test("a dotted key keeps its dots", () => {
    // Split on the LAST dot: "timing.dns.desc" is one key and one direction,
    // not three segments.
    expect(parseSort("timing.dns.desc")).toEqual({ key: "timing.dns", desc: true });
  });

  test("no sort is absent from the URL, not an empty param", () => {
    expect(serializeSort(null)).toBeUndefined();
  });

  test("junk is no sort rather than a crash", () => {
    expect(parseSort("at")).toBeNull();
    expect(parseSort("at.sideways")).toBeNull();
    expect(parseSort(".desc")).toBeNull();
    expect(parseSort(undefined)).toBeNull();
  });
});

describe("search schema", () => {
  const schema = tableSearchSchema({
    outcome: filterParam.checkbox(),
    latency: filterParam.range(),
    q: filterParam.text(),
  });

  test("a bare value widens into a multi-select", () => {
    // `?outcome=denied` is what a person types; `?outcome=["denied"]` is what
    // the app writes. Both have to mean the same thing.
    expect(schema.parse({ outcome: "denied" })).toMatchObject({ outcome: ["denied"] });
  });

  test("a malformed param degrades to absent, never to an error page", () => {
    // A URL is a convenience copy of state. One stale link must not take the
    // page down.
    expect(schema.parse({ latency: "nonsense", sort: "!!", live: "yes" })).toEqual({});
  });

  test("the three shared controls are always accepted", () => {
    expect(schema.parse({ sort: "at.desc", row: "evt_1", live: true })).toEqual({
      sort: "at.desc",
      row: "evt_1",
      live: true,
    });
  });
});

describe("filterValuesOf", () => {
  test("an unknown key never reaches the store", () => {
    expect(filterValuesOf({ outcome: ["denied"], nope: 1, row: "evt_1" }, specs)).toEqual({
      outcome: ["denied"],
    });
  });

  test("an enum member outside the declaration is dropped", () => {
    expect(filterValuesOf({ outcome: ["denied", "fatal"] }, specs)).toEqual({
      outcome: ["denied"],
    });
  });

  test("a range is clamped to its declared bounds", () => {
    // The same clamp the server runs: a hand-written or generated URL cannot
    // ask for a wider range than the column declares.
    expect(filterValuesOf({ latency: [-50, 99_999] }, specs)).toEqual({ latency: [0, 5000] });
  });
});

describe("canLoadMore", () => {
  test("stops one page early when the server has reported the count", () => {
    // `hasNextPage` stays true until a fetch comes back empty, which spends a
    // round trip proving there is nothing left.
    expect(canLoadMore({ hasNextPage: true, loaded: 500, filterRowCount: 500 })).toBe(false);
    expect(canLoadMore({ hasNextPage: true, loaded: 450, filterRowCount: 500 })).toBe(true);
  });

  test("without a count, the feed's own answer is the only one there is", () => {
    expect(canLoadMore({ hasNextPage: true, loaded: 50, filterRowCount: null })).toBe(true);
    expect(canLoadMore({ hasNextPage: false, loaded: 50, filterRowCount: null })).toBe(false);
  });

  test("the end of the feed outranks any count", () => {
    expect(canLoadMore({ hasNextPage: false, loaded: 10, filterRowCount: 999 })).toBe(false);
  });
});
