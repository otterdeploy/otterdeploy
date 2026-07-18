/**
 * Backoff/due selection for the orphaned-resource GC sweep. `isOrphanDue`
 * decides whether a recorded orphan gets another teardown attempt this pass:
 * never-tried rows are always due; retried rows wait an exponential backoff
 * keyed on their attempt count (capped) so a persistently-unreachable object
 * isn't hammered every tick.
 */
import { describe, expect, it } from "vite-plus/test";

import { isOrphanDue } from "../orphan-gc";

const AT = (iso: string) => new Date(iso);

describe("isOrphanDue", () => {
  it("is always due when never attempted", () => {
    expect(isOrphanDue({ attempts: 0, lastAttemptAt: null }, AT("2026-07-18T00:00:00Z"))).toBe(
      true,
    );
  });

  it("is not due within the first-failure backoff window", () => {
    // attempts=1 ⇒ backoff = base * 2^1 = 2m. 90s later is still inside it.
    const row = { attempts: 1, lastAttemptAt: AT("2026-07-18T00:00:00Z") };
    expect(isOrphanDue(row, AT("2026-07-18T00:01:30Z"), 60_000)).toBe(false);
  });

  it("becomes due once the backoff window elapses", () => {
    const row = { attempts: 1, lastAttemptAt: AT("2026-07-18T00:00:00Z") };
    expect(isOrphanDue(row, AT("2026-07-18T00:02:30Z"), 60_000)).toBe(true);
  });

  it("caps the backoff so a very stuck row still retries within an hour", () => {
    // attempts=50 would overflow without the cap; the exponent is clamped and
    // the whole backoff is capped at 1h, so 61m later it is due again.
    const row = { attempts: 50, lastAttemptAt: AT("2026-07-18T00:00:00Z") };
    expect(isOrphanDue(row, AT("2026-07-18T01:01:00Z"), 60_000)).toBe(true);
    expect(isOrphanDue(row, AT("2026-07-18T00:30:00Z"), 60_000)).toBe(false);
  });
});
