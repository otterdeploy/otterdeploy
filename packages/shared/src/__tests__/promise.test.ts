import { describe, expect, test } from "vite-plus/test";

import { mapLimit, sleep } from "../promise";

/**
 * `mapLimit` is what turned a stack rollout from "sum of its services" into
 * "slowest few". The two properties that matter are that results still line up
 * with their inputs, and that the cap is real: an unbounded version would open
 * every image pull against one Docker daemon at once.
 */
describe("mapLimit", () => {
  test("preserves result order regardless of completion order", async () => {
    const delays = [30, 0, 20, 10, 5];
    const out = await mapLimit(
      delays.map((ms, i) => async () => {
        await sleep(ms);
        return i;
      }),
      3,
    );
    expect(out).toEqual([0, 1, 2, 3, 4]);
  });

  test("never exceeds the limit, and does use it", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapLimit(
      Array.from({ length: 12 }, () => async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await sleep(5);
        inFlight--;
      }),
      4,
    );
    expect(peak).toBe(4);
    expect(inFlight).toBe(0);
  });

  test("runs concurrently rather than serially", async () => {
    const started = Date.now();
    await mapLimit(
      Array.from({ length: 4 }, () => () => sleep(40)),
      4,
    );
    // Serial would be ~160ms. Generous bound: this asserts concurrency, not
    // scheduler precision.
    expect(Date.now() - started).toBeLessThan(140);
  });

  test("an empty list resolves without spawning a worker", async () => {
    expect(await mapLimit([], 4)).toEqual([]);
  });

  test("a limit below one still makes progress", async () => {
    expect(await mapLimit([() => Promise.resolve("a")], 0)).toEqual(["a"]);
  });

  test("propagates a rejection, so callers must handle their own failures", async () => {
    const boom = mapLimit([() => Promise.resolve(1), () => Promise.reject(new Error("nope"))], 2);
    await expect(boom).rejects.toThrow("nope");
  });
});
