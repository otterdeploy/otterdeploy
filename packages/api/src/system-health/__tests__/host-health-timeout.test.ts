import { describe, expect, test } from "vitest";

import { withTimeout } from "../host-health";

describe("withTimeout (od-1kc.6)", () => {
  test("resolves with the value when the promise settles before the deadline", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 50);
    expect(result).toBe("ok");
  });

  test("resolves to null (not a hang) when the promise never settles before the deadline", async () => {
    const never = new Promise<string>(() => {
      // Deliberately never resolves/rejects — simulates a wedged Docker
      // daemon call. Before od-1kc.6's fix, `getHostHealth` awaited this
      // directly, so the whole RPC (and the Servers page's Host health
      // card) hung forever instead of degrading to "unavailable".
    });
    const result = await withTimeout(never, 20);
    expect(result).toBeNull();
  });

  test("a rejection also degrades to null rather than throwing", async () => {
    const result = await withTimeout(Promise.reject(new Error("boom")), 50);
    expect(result).toBeNull();
  });
});
