import { describe, expect, test } from "vite-plus/test";

import { MINUTE } from "../model";
import { rebuildRange } from "../obligations";

describe("rebuild range of a new record", () => {
  test("starts five minutes back even when the record itself is certain", () => {
    // Inserting a certain record before an uncertain successor moves the
    // predecessor's cut later, lengthening it back toward successor.t - successor.u.
    expect(rebuildRange({ t: 100 * MINUTE, unc: 0, ttl: 3 * MINUTE }, 0).lo).toBe(95 * MINUTE);
    expect(rebuildRange({ t: 100 * MINUTE, unc: 20_000, ttl: 3 * MINUTE }, 0).lo).toBe(95 * MINUTE);
  });

  test("reaches the predecessor's old TTL end through the series' largest TTL", () => {
    expect(rebuildRange({ t: 100 * MINUTE, unc: 0, ttl: MINUTE }, 15 * MINUTE).hi).toBe(
      115 * MINUTE,
    );
    expect(rebuildRange({ t: 100 * MINUTE, unc: 30_000, ttl: 20 * MINUTE }, 15 * MINUTE).hi).toBe(
      120 * MINUTE + 30_000,
    );
  });
});
