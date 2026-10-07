/**
 * The Variables tab's honesty rests on this: a saved variable is "pending"
 * until a spec write READ the env after it.
 */
import { describe, expect, test } from "vite-plus/test";

import { envBagChanged } from "../queries/env-liveness";
import { envLiveness } from "../views";

const at = (s: number) => new Date(Date.UTC(2026, 9, 7, 12, 0, s));

describe("envLiveness", () => {
  test("a change after the last roll is pending", () => {
    expect(envLiveness({ envChangedAt: at(30), envAppliedAt: at(10), stackId: null }).state).toBe(
      "pending",
    );
  });

  test("a change no roll has read yet is pending", () => {
    expect(envLiveness({ envChangedAt: at(30), envAppliedAt: null, stackId: null }).state).toBe(
      "pending",
    );
  });

  test("a roll that read the env at or after the change is live", () => {
    expect(envLiveness({ envChangedAt: at(30), envAppliedAt: at(30), stackId: null }).state).toBe(
      "live",
    );
    expect(envLiveness({ envChangedAt: null, envAppliedAt: at(5), stackId: null }).state).toBe(
      "live",
    );
  });

  test("says unknown rather than guessing live", () => {
    // Both stamps predate tracking.
    expect(envLiveness({ envChangedAt: null, envAppliedAt: null, stackId: null }).state).toBe(
      "unknown",
    );
    // A compose child's env rolls with its stack, not through redeployOne.
    expect(
      envLiveness({ envChangedAt: at(30), envAppliedAt: at(10), stackId: "res_stack" }).state,
    ).toBe("unknown");
  });

  test("carries the instants for the tab to show", () => {
    expect(envLiveness({ envChangedAt: at(30), envAppliedAt: at(10), stackId: null })).toEqual({
      state: "pending",
      changedAt: at(30).toISOString(),
      appliedAt: at(10).toISOString(),
    });
  });
});

describe("envBagChanged", () => {
  const bag = [
    { key: "A", value: "1" },
    { key: "B", value: "2", isSecret: true },
  ];

  test("an unchanged wholesale save is not a change", () => {
    expect(envBagChanged(bag, [...bag].reverse())).toBe(false);
  });

  test("an added, removed, edited or re-flagged key is", () => {
    expect(envBagChanged(bag, [...bag, { key: "C", value: "3" }])).toBe(true);
    expect(envBagChanged(bag, bag.slice(1))).toBe(true);
    expect(
      envBagChanged(bag, [
        { key: "A", value: "9" },
        { key: "B", value: "2", isSecret: true },
      ]),
    ).toBe(true);
    expect(
      envBagChanged(bag, [
        { key: "A", value: "1" },
        { key: "B", value: "2" },
      ]),
    ).toBe(true);
  });
});
