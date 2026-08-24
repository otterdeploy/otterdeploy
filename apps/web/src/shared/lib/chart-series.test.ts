import { describe, expect, it } from "vite-plus/test";

import { dimmedSeriesColor, rankSeries, seriesColor, seriesPalette } from "./chart-series";

describe("seriesColor", () => {
  it("spends saturation and lightness as theme tokens, never literals", () => {
    // The whole point: a theme switch must move S/L without touching identity.
    expect(seriesColor(0, 4)).toContain("var(--chart-series-s)");
    expect(seriesColor(0, 4)).toContain("var(--chart-series-l)");
  });

  it("spaces hues evenly around the wheel", () => {
    const hues = [0, 1, 2, 3].map((i) => Number(/hsl\(([\d.]+)/.exec(seriesColor(i, 4))?.[1]));
    const gaps = hues.slice(1).map((h, i) => (h - hues[i] + 360) % 360);
    expect(gaps).toEqual([90, 90, 90]);
  });

  it("keeps every hue inside one turn", () => {
    for (let i = 0; i < 12; i++) {
      const hue = Number(/hsl\(([\d.]+)/.exec(seriesColor(i, 12))?.[1]);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it("gives slot zero the same hue whatever the series count", () => {
    // Adding a container must not repaint the one above it.
    const first = seriesColor(0, 3);
    expect(seriesColor(0, 9)).toBe(first);
    expect(seriesColor(0, 40)).toBe(first);
  });

  it("does not divide by zero on an empty count", () => {
    expect(() => seriesColor(0, 0)).not.toThrow();
  });
});

describe("dimmedSeriesColor", () => {
  it("keeps the hue and drops only the alpha", () => {
    const lit = seriesColor(2, 5);
    const dim = dimmedSeriesColor(2, 5);
    const hueOf = (c: string) => /hsl\(([\d.]+)/.exec(c)?.[1];
    expect(hueOf(dim)).toBe(hueOf(lit));
    expect(dim).toContain("/ 0.12");
  });
});

describe("seriesPalette", () => {
  it("assigns one colour per label in the order given", () => {
    const palette = seriesPalette(["caddy", "postgres", "builder"]);
    expect(Object.keys(palette)).toEqual(["caddy", "postgres", "builder"]);
    expect(new Set(Object.values(palette)).size).toBe(3);
  });

  it("returns an empty palette for no series rather than throwing", () => {
    expect(seriesPalette([])).toEqual({});
  });
});

describe("rankSeries", () => {
  it("orders by magnitude descending so the biggest contributor holds slot zero", () => {
    const totals = new Map([
      ["builder", 12],
      ["postgres", 340],
      ["caddy", 88],
    ]);
    expect(rankSeries(totals)).toEqual(["postgres", "caddy", "builder"]);
  });

  it("breaks ties on the label so the order is stable across renders", () => {
    const totals = new Map([
      ["zeta", 10],
      ["alpha", 10],
      ["mu", 10],
    ]);
    expect(rankSeries(totals)).toEqual(["alpha", "mu", "zeta"]);
  });

  it("handles an empty set", () => {
    expect(rankSeries(new Map())).toEqual([]);
  });
});
