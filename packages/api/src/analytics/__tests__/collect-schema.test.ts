import { describe, expect, test } from "vite-plus/test";

import {
  MAX_EVENTS_PER_BATCH,
  MAX_PROP_KEYS,
  parseCollectBody,
  sanitizeProps,
} from "../collect-schema";

const KEY = `od_${"ab".repeat(16)}`;

function batch(events: unknown[]): string {
  return JSON.stringify({ k: KEY, v: 1, sid: "tab-1", e: events });
}

const pv = {
  id: "e1",
  t: "pv",
  ts: 1_724_650_000_000,
  u: "https://example.com/pricing",
  r: "https://google.com/",
  ti: "Pricing",
  sw: 1440,
  l: "en-GB",
};

describe("parseCollectBody", () => {
  test("accepts a valid batch of each event kind", () => {
    const res = parseCollectBody(
      batch([
        pv,
        { id: "e2", t: "ev", ts: 1, u: "https://example.com/", n: "signup", p: { plan: "pro" } },
        { id: "e3", t: "eng", ts: 2, u: "https://example.com/", a: 12_400, vis: 30_100, sc: 80 },
        { id: "e4", t: "hb", ts: 3, u: "https://example.com/" },
        { id: "e5", t: "id", ts: 4, uid: "user_123" },
      ]),
    );
    expect(res.isOk()).toBe(true);
    if (res.isOk()) {
      expect(res.value.k).toBe(KEY);
      expect(res.value.e).toHaveLength(5);
    }
  });

  test("rejects malformed JSON", () => {
    expect(parseCollectBody("{nope").isErr()).toBe(true);
  });

  test("rejects a key that is not od_ + 32 hex", () => {
    expect(parseCollectBody(JSON.stringify({ k: "od_XYZ", v: 1, sid: "s", e: [pv] })).isErr()).toBe(
      true,
    );
    expect(
      parseCollectBody(
        JSON.stringify({ k: `pk_${"ab".repeat(16)}`, v: 1, sid: "s", e: [pv] }),
      ).isErr(),
    ).toBe(true);
  });

  test("rejects an unknown version and a missing sid", () => {
    expect(parseCollectBody(JSON.stringify({ k: KEY, v: 2, sid: "s", e: [] })).isErr()).toBe(true);
    expect(parseCollectBody(JSON.stringify({ k: KEY, v: 1, sid: "", e: [] })).isErr()).toBe(true);
  });

  test("rejects more than 50 events", () => {
    const events = Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, (_, i) => ({
      ...pv,
      id: `e${i}`,
    }));
    expect(parseCollectBody(batch(events)).isErr()).toBe(true);
  });

  test("rejects a custom event with a bad name", () => {
    expect(
      parseCollectBody(
        batch([{ id: "e", t: "ev", ts: 1, u: "https://x.com/", n: " lead" }]),
      ).isErr(),
    ).toBe(true);
    expect(
      parseCollectBody(
        batch([{ id: "e", t: "ev", ts: 1, u: "https://x.com/", n: "Sign Up" }]),
      ).isOk(),
    ).toBe(true);
  });
});

describe("sanitizeProps", () => {
  test("keeps strings, finite numbers and booleans only", () => {
    expect(
      sanitizeProps({
        plan: "pro",
        seats: 5,
        trial: true,
        nested: { a: 1 },
        list: [1, 2],
        none: null,
        nan: Number.NaN,
        inf: Number.POSITIVE_INFINITY,
      }),
    ).toEqual({ plan: "pro", seats: 5, trial: true });
  });

  test("drops secret-shaped keys", () => {
    expect(
      sanitizeProps({
        token: "x",
        apiKey: "x",
        api_key: "x",
        Authorization: "x",
        userEmail: "x",
        password: "x",
        cardNumber: "x",
        ok: "kept",
      }),
    ).toEqual({ ok: "kept" });
  });

  test("caps key count and value length", () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < MAX_PROP_KEYS + 10; i++) big[`k${i}`] = "v";
    const out = sanitizeProps(big);
    expect(Object.keys(out ?? {})).toHaveLength(MAX_PROP_KEYS);

    const long = sanitizeProps({ text: "x".repeat(400) });
    expect(typeof long?.text === "string" && long.text.length).toBe(256);

    expect(sanitizeProps({ [`k${"x".repeat(60)}`]: "v" })).toBeNull();
  });

  test("returns null for non-objects and empty survivors", () => {
    expect(sanitizeProps(undefined)).toBeNull();
    expect(sanitizeProps("str")).toBeNull();
    expect(sanitizeProps([1, 2])).toBeNull();
    expect(sanitizeProps({ token: "x" })).toBeNull();
  });
});
