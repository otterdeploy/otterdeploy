/**
 * The time axis spans the window the reader picked, not the data.
 *
 * "Last 30 minutes · live" used to be drawn on an axis running
 * 18:00 → 00:00 → 18:00: one sample on a fitted, niced axis became a day.
 */
import { describe, expect, it } from "vite-plus/test";

import { updatedAgo } from "@/features/resources/components/_shared/metrics/metrics-tab-chrome";
import { metricTimeWindow } from "@/features/resources/components/_shared/metrics/use-resource-metrics";
import { epochMsOf } from "@/shared/lib/clock";

import { axisDomain, chartAxes, timeXAxis } from "./time-axis";

const MINUTE = 60_000;
const END = 1_791_000_000_000;

describe("metricTimeWindow", () => {
  it("reaches back the selected minutes from the fetch", () => {
    expect(metricTimeWindow(END, 30)).toEqual({ startMs: END - 30 * MINUTE, endMs: END });
  });

  it("has no window before there is an instant to anchor on", () => {
    expect(metricTimeWindow(0, 30)).toBeUndefined();
    expect(metricTimeWindow(END, 0)).toBeUndefined();
  });
});

describe("timeXAxis", () => {
  const oneSample = [{ ts: END - MINUTE }];

  it("draws exactly the pinned window for a single sample", () => {
    const window = metricTimeWindow(END, 30);
    const axis = timeXAxis(oneSample, window, 800);
    expect(axis.nice).toBe(false);
    if (typeof axis.scale === "function" && "domain" in axis.scale) {
      const domain = axis.scale.domain().map((d: Date) => epochMsOf(d));
      expect(domain).toEqual([END - 30 * MINUTE, END]);
    } else {
      throw new Error("a pinned window must produce a configured scale instance");
    }
    // Every tick lands inside the half hour: no day-long scale around a dot.
    expect(axis.ticks.values?.length).toBeGreaterThan(0);
    for (const tick of axis.ticks.values ?? []) {
      const ms = epochMsOf(tick);
      expect(ms).toBeGreaterThanOrEqual(END - 30 * MINUTE);
      expect(ms).toBeLessThanOrEqual(END);
    }
  });

  it("spans the data exactly when no window is given", () => {
    const rows = [{ ts: END - 10 * MINUTE }, { ts: END }];
    expect(axisDomain(rows, undefined)).toEqual({ startMs: END - 10 * MINUTE, endMs: END });
    expect(timeXAxis(rows, undefined, 800).nice).toBe(false);
  });

  it("ignores an empty or inverted window", () => {
    expect(timeXAxis(oneSample, { startMs: END, endMs: END }, 800).nice).toBe(true);
  });

  it("fits fewer labels on a narrower chart", () => {
    const window = metricTimeWindow(END, 30);
    const wide = timeXAxis(oneSample, window, 1200).ticks.values ?? [];
    const narrow = timeXAxis(oneSample, window, 300).ticks.values ?? [];
    expect(narrow.length).toBeLessThan(wide.length);
  });
});

describe("updatedAgo", () => {
  it("says how old the charts are, in words", () => {
    expect(updatedAgo(END - 12_000, END)).toBe("updated 12s ago");
    expect(updatedAgo(END - 75_000, END)).toBe("updated 1m 15s ago");
  });

  it("says nothing before the first answer", () => {
    expect(updatedAgo(0, END)).toBe("");
  });
});

describe("chartAxes", () => {
  // The chart throws "Axis ticks accept only one candidate policy" when an
  // axis carries `values` beside `spacing` or `count`, and takes the whole
  // chart down with it. Each axis must pick exactly one.
  const base = {
    data: [{ ts: END - 30 * MINUTE }, { ts: END }],
    timeWindow: undefined,
    widthPx: 800,
    format: String,
    max: "auto" as const,
    compact: false,
    sampleIntervalMs: 0,
  };

  function policies(ticks: object): string[] {
    return ["values", "spacing", "count"].filter((key) => key in ticks);
  }

  it("gives each axis exactly one tick policy", () => {
    for (const countPeak of [undefined, 0, 7]) {
      const { x, y } = chartAxes({ ...base, countPeak });
      if (x.axis === false || y.axis === false) throw new Error("axes expected");
      expect(policies(x.axis.ticks)).toHaveLength(1);
      expect(policies(y.axis.ticks)).toHaveLength(1);
    }
  });

  it("ticks a count axis on whole numbers up to a reachable top", () => {
    const { y } = chartAxes({ ...base, countPeak: 0 });
    if (y.axis === false) throw new Error("axis expected");
    expect(y.axis.ticks).toMatchObject({ values: [0, 1] });
    expect(y.domain).toEqual([0, 1]);
  });
});
