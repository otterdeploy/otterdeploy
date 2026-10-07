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

import { axisTickFormat, timeAxisScale } from "./time-axis";

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

describe("timeAxisScale", () => {
  const oneSample = [{ ts: END - MINUTE }];

  it("draws exactly the pinned window for a single sample", () => {
    const window = metricTimeWindow(END, 30);
    const axis = timeAxisScale(oneSample, window);
    expect(axis.spanMs).toBe(30 * MINUTE);
    expect(axis.nice).toBe(false);
    if (typeof axis.scale === "function" && "domain" in axis.scale) {
      const domain = axis.scale.domain().map((d: Date) => epochMsOf(d));
      expect(domain).toEqual([END - 30 * MINUTE, END]);
      // Every tick lands inside the half hour: no day-long scale around a dot.
      for (const tick of axis.scale.ticks()) {
        const ms = epochMsOf(tick);
        expect(ms).toBeGreaterThanOrEqual(END - 30 * MINUTE);
        expect(ms).toBeLessThanOrEqual(END);
      }
    } else {
      throw new Error("a pinned window must produce a configured scale instance");
    }
  });

  it("still fits the data when no window is given", () => {
    const rows = [{ ts: END - 10 * MINUTE }, { ts: END }];
    const axis = timeAxisScale(rows, undefined);
    expect(axis.spanMs).toBe(10 * MINUTE);
    expect(axis.nice).toBe(true);
  });

  it("ignores an empty or inverted window", () => {
    expect(timeAxisScale(oneSample, { startMs: END, endMs: END }).nice).toBe(true);
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

describe("axisTickFormat", () => {
  const at = Date.UTC(2026, 9, 7, 9, 5, 30);

  it("labels seconds up to fifteen minutes, minutes up to two days, dates beyond", () => {
    const seconds = axisTickFormat(15 * MINUTE)(at);
    const minutes = axisTickFormat(15 * MINUTE + 1)(at);
    const days = axisTickFormat(2 * 24 * 60 * MINUTE)(at);
    expect(seconds.split(":")).toHaveLength(3);
    expect(minutes.split(":")).toHaveLength(2);
    expect(days).not.toContain(":");
  });
});
