import { describe, expect, it } from "bun:test";

import {
  DEFAULT_THRESHOLDS,
  meterState,
  normalizeThresholds,
} from "../thresholds";

describe("meterState", () => {
  it("classifies against the default levels", () => {
    expect(meterState(0)).toBe("good");
    expect(meterState(64.9)).toBe("good");
    expect(meterState(65)).toBe("warn");
    expect(meterState(89.9)).toBe("warn");
    expect(meterState(90)).toBe("crit");
    expect(meterState(100)).toBe("crit");
  });

  it("is inclusive at both boundaries", () => {
    const t = { warn: 50, crit: 80 };
    expect(meterState(50, t)).toBe("warn");
    expect(meterState(80, t)).toBe("crit");
  });

  it("honours operator levels over the defaults", () => {
    // 70% is fine on an archive box and an emergency on a build host.
    expect(meterState(70, { warn: 90, crit: 95 })).toBe("good");
    expect(meterState(70, { warn: 40, crit: 60 })).toBe("crit");
  });

  it("degrades to the worse state when warn is misconfigured above crit", () => {
    // crit is tested first, so a bad pair can never silently suppress crit.
    expect(meterState(95, { warn: 99, crit: 90 })).toBe("crit");
  });

  it("never raises an alarm off a reading that is not a number", () => {
    // NaN and Infinity both mean "we did not measure this". Painting them
    // critical would fabricate an alert out of a failed read, which is the
    // opposite of what honest-about-system-state asks for.
    expect(meterState(Number.NaN)).toBe("good");
    expect(meterState(Number.POSITIVE_INFINITY)).toBe("good");
    expect(meterState(Number.NEGATIVE_INFINITY)).toBe("good");
  });

  it("clamps CPU above 100% to critical rather than wrapping", () => {
    // Docker-style CPU legitimately exceeds 100% on a multi-core host.
    expect(meterState(340)).toBe("crit");
  });
});

describe("normalizeThresholds", () => {
  it("fills missing sides from the defaults", () => {
    expect(normalizeThresholds({})).toEqual(DEFAULT_THRESHOLDS);
    expect(normalizeThresholds({ warn: 40 })).toEqual({ warn: 40, crit: 90 });
  });

  it("pulls warn down to crit rather than accepting an inverted pair", () => {
    expect(normalizeThresholds({ warn: 95, crit: 80 })).toEqual({ warn: 80, crit: 80 });
  });

  it("allows a single hard line", () => {
    expect(normalizeThresholds({ warn: 80, crit: 80 })).toEqual({ warn: 80, crit: 80 });
  });

  it("clamps to a usable percentage range and rounds", () => {
    expect(normalizeThresholds({ warn: -20, crit: 400 })).toEqual({ warn: 1, crit: 100 });
    expect(normalizeThresholds({ warn: 64.6, crit: 89.2 })).toEqual({ warn: 65, crit: 89 });
  });

  it("falls back rather than persisting a non-finite level", () => {
    expect(normalizeThresholds({ crit: Number.NaN })).toEqual(DEFAULT_THRESHOLDS);
  });
});
