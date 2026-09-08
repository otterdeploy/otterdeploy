import type { FilterSpec } from "@otterdeploy/shared/table-filters";

import { describe, expect, test } from "vite-plus/test";

import { parseQuery, partialToken, replaceWord, serializeQuery, tokenize, wordAt } from "./grammar";

const specs: FilterSpec[] = [
  { key: "outcome", type: "checkbox", kind: "enum", options: ["success", "failure", "denied"] },
  { key: "action", type: "checkbox", kind: "string" },
  { key: "latency", type: "slider", kind: "number", min: 0, max: 5000 },
  { key: "at", type: "timerange", kind: "instant" },
  { key: "reason", type: "input", kind: "string" },
  { key: "q", type: "search", kind: "string", keys: ["action", "reason"] },
];

describe("tokenize", () => {
  test("splits on the FIRST colon", () => {
    // Values contain colons — RPC paths, timestamps, URLs — and splitting on
    // every colon truncates the value at the second one.
    expect(tokenize("action:project.create url:https://x.dev/a")).toEqual([
      { key: "action", value: "project.create" },
      { key: "url", value: "https://x.dev/a" },
    ]);
  });

  test("quotes hold a value with spaces together", () => {
    expect(tokenize('reason:"not a member" outcome:denied')).toEqual([
      { key: "reason", value: "not a member" },
      { key: "outcome", value: "denied" },
    ]);
  });

  test("bare words that are not tokens are ignored", () => {
    expect(tokenize("just some words outcome:denied")).toEqual([
      { key: "outcome", value: "denied" },
    ]);
  });
});

describe("parseQuery", () => {
  test("a union becomes a multi-select", () => {
    expect(parseQuery("outcome:denied,failure", specs)).toEqual({
      outcome: ["denied", "failure"],
    });
  });

  test("a range becomes both ends", () => {
    expect(parseQuery("latency:100-500", specs)).toEqual({ latency: [100, 500] });
  });

  test("one number is a point range, matching a one-handle slider", () => {
    expect(parseQuery("latency:250", specs)).toEqual({ latency: [250, 250] });
  });

  test("an unknown key never survives", () => {
    expect(parseQuery("nope:1 outcome:denied", specs)).toEqual({ outcome: ["denied"] });
  });

  test("a value the declaration rejects is dropped, not guessed at", () => {
    // The same coercion the URL and the server run: an enum member that does
    // not exist cannot enter the filter state from any door.
    expect(parseQuery("outcome:fatal", specs)).toEqual({});
    expect(parseQuery("latency:0-99999", specs)).toEqual({ latency: [0, 5000] });
  });

  test("an empty query is no filter", () => {
    expect(parseQuery("", specs)).toEqual({});
    expect(parseQuery("   ", specs)).toEqual({});
  });
});

describe("round trip", () => {
  test("a query survives parse → serialize", () => {
    const query = "outcome:denied,failure latency:100-500";
    expect(serializeQuery(parseQuery(query, specs), specs)).toBe(query);
  });

  test("values survive serialize → parse", () => {
    // The property that makes the palette a faster way into the SAME filter
    // state, rather than a second filter system beside it.
    const values = { outcome: ["denied"], latency: [0, 250], reason: "not a member" };
    expect(parseQuery(serializeQuery(values, specs), specs)).toEqual(values);
  });

  test("a value with spaces is quoted, so it stays one value", () => {
    expect(serializeQuery({ reason: "not a member" }, specs)).toBe('reason:"not a member"');
  });

  test("serialization follows declaration order, not insertion order", () => {
    // Two people filtering the same way get the same line, and therefore the
    // same suggestion history.
    expect(serializeQuery({ latency: [1, 2], outcome: ["denied"] }, specs)).toBe(
      "outcome:denied latency:1-2",
    );
  });
});

describe("caret helpers", () => {
  test("wordAt reads the token under the caret", () => {
    expect(wordAt("outcome:denied action:x", 5)).toBe("outcome:denied");
    expect(wordAt("outcome:denied action:x", 20)).toBe("action:x");
  });

  test("replaceWord leaves the rest of the line alone", () => {
    expect(replaceWord("outcome:den action:x", 8, "outcome:denied")).toBe(
      "outcome:denied action:x",
    );
  });

  test("partialToken splits a half-typed token", () => {
    expect(partialToken("outcome:den")).toEqual({ key: "outcome", value: "den" });
    expect(partialToken("outcome:")).toEqual({ key: "outcome", value: "" });
    // Not a token yet: no key to complete against.
    expect(partialToken("outcome")).toBeNull();
    expect(partialToken(":denied")).toBeNull();
  });
});
