import { describe, expect, test } from "bun:test";

import { omitUndefined } from "../object";

describe("omitUndefined", () => {
  test("strips undefined-valued keys", () => {
    const out = omitUndefined({ a: 1, b: undefined, c: "x" });
    expect(out).toEqual({ a: 1, c: "x" });
    expect("b" in out).toBe(false);
  });

  test("keeps null — null and undefined carry different intent", () => {
    const out = omitUndefined({ a: null, b: undefined });
    expect(out).toEqual({ a: null });
    expect("a" in out).toBe(true);
    expect("b" in out).toBe(false);
  });

  test("keeps falsy non-undefined values", () => {
    const out = omitUndefined({ a: 0, b: "", c: false, d: undefined });
    expect(out).toEqual({ a: 0, b: "", c: false });
  });

  test("returns a fresh object — does not mutate input", () => {
    const input = { a: 1, b: undefined };
    const out = omitUndefined(input);
    expect(out).not.toBe(input);
    // Input is left intact (the undefined key still enumerates).
    expect("b" in input).toBe(true);
  });

  test("nested objects are not walked — shallow only", () => {
    const inner = { x: undefined, y: 1 };
    const out = omitUndefined({ inner });
    // The nested undefined survives — only top-level keys are stripped.
    expect(out.inner).toBe(inner);
    expect(out.inner.x).toBeUndefined();
  });

  test("empty object round-trips", () => {
    expect(omitUndefined({})).toEqual({});
  });

  test("only-undefined object becomes empty", () => {
    expect(omitUndefined({ a: undefined, b: undefined })).toEqual({});
  });
});
