import { describe, expect, test } from "bun:test";

import { MAX_TAGS, normalizeTag, normalizeTags } from "../data-tags";

describe("normalizeTag", () => {
  test("lowercases, trims and folds whitespace to one hyphen", () => {
    expect(normalizeTag("  Customer   Acme ")).toBe("customer-acme");
    expect(normalizeTag("EU")).toBe("eu");
  });

  test("keeps dots, dashes and underscores; refuses everything else", () => {
    expect(normalizeTag("v1.2_beta-x")).toBe("v1.2_beta-x");
    expect(normalizeTag("customer/acme")).toBeNull();
    expect(normalizeTag("#prod")).toBeNull();
    expect(normalizeTag("-leading")).toBeNull();
  });

  test("empty and over-long are nothing", () => {
    expect(normalizeTag("   ")).toBeNull();
    expect(normalizeTag("a".repeat(25))).toBeNull();
    expect(normalizeTag("a".repeat(24))).toBe("a".repeat(24));
  });
});

describe("normalizeTags", () => {
  test("dedupes after normalising, keeping first-seen order", () => {
    expect(normalizeTags(["Prod", "eu", "prod", " EU "])).toEqual({
      ok: true,
      tags: ["prod", "eu"],
    });
  });

  test("drops blanks silently but names a malformed tag", () => {
    expect(normalizeTags(["", "ok", "  "])).toEqual({ ok: true, tags: ["ok"] });
    const bad = normalizeTags(["ok", "bad/one"]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toContain('"bad/one"');
  });

  test("caps the count after deduping, not before", () => {
    const eight = Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`);
    expect(normalizeTags([...eight, "t0"])).toEqual({ ok: true, tags: eight });
    expect(normalizeTags([...eight, "t9"]).ok).toBe(false);
  });
});
