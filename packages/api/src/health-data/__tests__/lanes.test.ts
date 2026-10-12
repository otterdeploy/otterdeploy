import { describe, expect, test } from "vite-plus/test";

import { admitBatch, type LaneState } from "../lanes";
import { MINUTE } from "../model";

const calm: LaneState = { pressureLevel: 0, rollupLagMs: 0, liveQueueAgeMs: 0, liveWaiting: false };

describe("live and replay lanes", () => {
  test("live is never refused, even at the last disk-pressure level with the rollup behind", () => {
    expect(
      admitBatch(true, {
        pressureLevel: 3,
        rollupLagMs: 60 * MINUTE,
        liveQueueAgeMs: 9_000,
        liveWaiting: true,
      }),
    ).toEqual({ admit: true });
  });

  test("replay is admitted when nothing competes", () => {
    expect(admitBatch(false, calm)).toEqual({ admit: true });
  });

  test("replay yields at the last disk-pressure level, past the lateness allowance, and to waiting live", () => {
    expect(admitBatch(false, { ...calm, pressureLevel: 3 })).toMatchObject({
      admit: false,
      reason: "disk_pressure",
    });
    expect(admitBatch(false, { ...calm, pressureLevel: 2 })).toEqual({ admit: true });
    expect(admitBatch(false, { ...calm, rollupLagMs: 5 * MINUTE + 1 })).toMatchObject({
      admit: false,
      reason: "rollup_lag",
    });
    expect(admitBatch(false, { ...calm, rollupLagMs: 5 * MINUTE })).toEqual({ admit: true });
    expect(admitBatch(false, { ...calm, liveWaiting: true })).toMatchObject({
      admit: false,
      reason: "live_busy",
    });
  });

  test("a live queue-age limit sheds replay only once live has waited that long", () => {
    const policy = { replayLagLimitMs: 5 * MINUTE, liveQueueAgeLimitMs: 200 };
    expect(admitBatch(false, { ...calm, liveWaiting: true, liveQueueAgeMs: 50 }, policy)).toEqual({
      admit: true,
    });
    expect(
      admitBatch(false, { ...calm, liveWaiting: true, liveQueueAgeMs: 200 }, policy),
    ).toMatchObject({ admit: false, reason: "live_busy" });
  });
});
