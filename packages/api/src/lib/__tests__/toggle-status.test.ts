import { describe, expect, test } from "vite-plus/test";

import { TOGGLE_ATTEMPTS, toggleWithRetry } from "../toggle-status";

/** The compare-and-set retry behind every pause toggle. */
describe("toggleWithRetry", () => {
  test("a click that lost the race tries again and lands", async () => {
    const outcomes: Array<string | null | "lost"> = ["lost", "paused"];
    let calls = 0;
    const row = await toggleWithRetry({
      attempt: async () => outcomes[calls++] ?? null,
      current: async () => "unused",
    });
    expect(row).toBe("paused");
    expect(calls).toBe(2);
  });

  test("a row that is gone answers null at once", async () => {
    let calls = 0;
    const row = await toggleWithRetry({
      attempt: async () => {
        calls++;
        return null;
      },
      current: async () => "unused",
    });
    expect(row).toBeNull();
    expect(calls).toBe(1);
  });

  test("past the attempt budget it answers the row as it stands", async () => {
    let calls = 0;
    const row = await toggleWithRetry<string>({
      attempt: async () => {
        calls++;
        return "lost";
      },
      current: async () => "active",
    });
    expect(row).toBe("active");
    expect(calls).toBe(TOGGLE_ATTEMPTS);
  });
});
