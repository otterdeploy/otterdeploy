import { describe, expect, test } from "vite-plus/test";

import { visitorDotColor, visitorIdentity } from "./visitor-name";

describe("visitorIdentity", () => {
  test("is deterministic for the same visitor id", () => {
    const a = visitorIdentity("v_8f3a91c2d4e5");
    const b = visitorIdentity("v_8f3a91c2d4e5");
    expect(a).toEqual(b);
  });

  test("renders as Adjective Animal", () => {
    const { name } = visitorIdentity("v_8f3a91c2d4e5");
    expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  test("hue sits on the wheel", () => {
    for (const id of ["a", "b", "abcdef0123456789", "v_x"]) {
      const { hue } = visitorIdentity(id);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  test("distinct ids spread across names rather than collapsing", () => {
    const names = new Set<string>();
    for (let i = 0; i < 200; i++) names.add(visitorIdentity(`visitor-${i}`).name);
    // 200 draws from a 1600-name space: a healthy hash lands well over 150.
    expect(names.size).toBeGreaterThan(120);
  });

  test("dot colour defers loudness to the theme tokens", () => {
    const { hue } = visitorIdentity("v_8f3a91c2d4e5");
    const color = visitorDotColor(hue);
    expect(color).toContain("var(--chart-series-s)");
    expect(color).toContain("var(--chart-series-l)");
  });
});
