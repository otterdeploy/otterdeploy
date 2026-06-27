import { describe, expect, test } from "bun:test";

import { omitUndefined } from "../object";

// `omitUndefined`'s mapped return type turns any key whose only value is
// `undefined` into a `never`-typed property, which makes `toEqual` against an
// object that omits that key fail to typecheck. Widen the received value to a
// plain record at the assertion — we're asserting runtime structural equality.
const struct = (value: object): Record<string, unknown> => value as Record<string, unknown>;

describe("omitUndefined", () => {
  test("strips undefined-valued keys", () => {
    const out = omitUndefined({ a: 1, b: undefined, c: "x" });
    expect(struct(out)).toEqual({ a: 1, c: "x" });
    expect("b" in out).toBe(false);
  });

  test("keeps null — null and undefined carry different intent", () => {
    const out = omitUndefined({ a: null, b: undefined });
    expect(struct(out)).toEqual({ a: null });
    expect("a" in out).toBe(true);
    expect("b" in out).toBe(false);
  });

  test("keeps falsy non-undefined values", () => {
    const out = omitUndefined({ a: 0, b: "", c: false, d: undefined });
    expect(struct(out)).toEqual({ a: 0, b: "", c: false });
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
    expect(struct(omitUndefined({ a: undefined, b: undefined }))).toEqual({});
  });
});
