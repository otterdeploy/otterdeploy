import { describe, expect, it } from "vite-plus/test";

import type { HealthRecommendation } from "../host-health";

import { clearedTitle, planPressureTransitions } from "../pressure-transitions";

const rec = (id: string, severity: "warning" | "critical" = "warning"): HealthRecommendation => ({
  id,
  severity,
  title: `${id} title`,
  detail: "",
  action: null,
});

const HOUR = 3_600_000;
const REMIND = 6 * HOUR;

describe("planPressureTransitions", () => {
  it("announces a recommendation the first time it appears", () => {
    const plan = planPressureTransitions({
      active: {},
      urgent: [rec("disk-pressure")],
      now: 1000,
      remindAfterMs: REMIND,
    });
    expect(plan.notify.map((r) => r.id)).toEqual(["disk-pressure"]);
    expect(plan.clear).toEqual([]);
    expect(plan.next).toEqual({
      "disk-pressure": { notifiedAt: 1000, title: "disk-pressure title" },
    });
  });

  it("stays silent while a known condition persists inside the reminder window", () => {
    const active = { "disk-pressure": { notifiedAt: 1000, title: "t" } };
    const plan = planPressureTransitions({
      active,
      urgent: [rec("disk-pressure")],
      now: 1000 + HOUR,
      remindAfterMs: REMIND,
    });
    expect(plan.notify).toEqual([]);
    expect(plan.clear).toEqual([]);
    // The original announcement time is kept, so the reminder clock is not reset by every tick.
    expect(plan.next["disk-pressure"]?.notifiedAt).toBe(1000);
  });

  it("reminds once the window has passed, and restarts the clock", () => {
    const active = { "disk-pressure": { notifiedAt: 1000, title: "t" } };
    const now = 1000 + REMIND;
    const plan = planPressureTransitions({
      active,
      urgent: [rec("disk-pressure")],
      now,
      remindAfterMs: REMIND,
    });
    expect(plan.notify.map((r) => r.id)).toEqual(["disk-pressure"]);
    expect(plan.next["disk-pressure"]?.notifiedAt).toBe(now);
  });

  it("clears a condition that stopped being urgent, naming it by its announced title", () => {
    const active = {
      "memory-critical": { notifiedAt: 1000, title: "Server memory is nearly exhausted" },
    };
    const plan = planPressureTransitions({ active, urgent: [], now: 2000, remindAfterMs: REMIND });
    expect(plan.notify).toEqual([]);
    expect(plan.clear).toEqual([
      { id: "memory-critical", title: "Server memory is nearly exhausted" },
    ]);
    expect(plan.next).toEqual({});
  });

  it("handles a swap in one tick: one clears, one is announced, one persists", () => {
    const active = {
      "memory-critical": { notifiedAt: 1000, title: "mem" },
      "disk-pressure": { notifiedAt: 1000, title: "disk" },
    };
    const plan = planPressureTransitions({
      active,
      urgent: [rec("disk-pressure"), rec("images-reclaimable")],
      now: 1000 + HOUR,
      remindAfterMs: REMIND,
    });
    expect(plan.notify.map((r) => r.id)).toEqual(["images-reclaimable"]);
    expect(plan.clear.map((c) => c.id)).toEqual(["memory-critical"]);
    expect(Object.keys(plan.next).sort()).toEqual(["disk-pressure", "images-reclaimable"]);
  });
});

describe("clearedTitle", () => {
  it("names the recovery for known recommendations and falls back sensibly", () => {
    expect(clearedTitle("memory-critical", "x")).toBe("Server memory recovered");
    expect(clearedTitle("disk-pressure", "x")).toBe("Disk pressure cleared");
    expect(clearedTitle("something-new", "Something new")).toBe("Something new — cleared");
  });
});
