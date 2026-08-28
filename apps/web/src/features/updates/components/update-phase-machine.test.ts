import { describe, expect, it } from "vite-plus/test";

import { walkStates } from "./update-phase-machine";

/** The projection is where the ordering rules actually live, so they are
 *  tested here rather than through a renderer: one segment in motion, nothing
 *  live ahead of an unsealed segment, and no reverse gear. */
describe("walkStates", () => {
  const base = { count: 5, failed: false };

  it("runs one live segment with nothing lit ahead of it", () => {
    expect(walkStates({ ...base, cursor: 1, goal: 1 })).toEqual([
      "done",
      "active",
      "idle",
      "idle",
      "idle",
    ]);
  });

  it("seals the segment it is on before the next one goes live", () => {
    // Goal two steps ahead: the cursor's segment seals, and the segment the
    // run has actually reached stays empty until that seal has landed.
    expect(walkStates({ ...base, cursor: 1, goal: 3 })).toEqual([
      "done",
      "sealing",
      "idle",
      "idle",
      "idle",
    ]);
  });

  it("never has two segments in motion at once", () => {
    for (let cursor = 0; cursor <= 5; cursor++) {
      for (let goal = cursor; goal <= 5; goal++) {
        const moving = walkStates({ ...base, cursor, goal }).filter(
          (s) => s === "active" || s === "sealing",
        );
        expect(moving.length).toBeLessThanOrEqual(1);
      }
    }
  });

  it("marks every segment done once the walk reaches the end", () => {
    expect(walkStates({ ...base, cursor: 5, goal: 5 })).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
    ]);
  });

  it("stops the walk at the failed segment", () => {
    expect(walkStates({ ...base, failed: true, cursor: 2, goal: 4 })).toEqual([
      "done",
      "done",
      "failed",
      "idle",
      "idle",
    ]);
  });
});
