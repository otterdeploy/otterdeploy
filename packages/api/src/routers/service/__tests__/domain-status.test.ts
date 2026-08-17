/**
 * The domain status projection has two independent gates and the wire must
 * keep them tellable-apart: `enabled` is SYSTEM-owned (recomputed by
 * expose/unexpose, domain add, and recheck from DNS/exposure verification);
 * `disabledByUser` is the operator's explicit off switch. A route serves
 * only when `enabled && !disabledByUser`, and a paused route must read
 * "paused" — not "disabled" — so nobody hunts for a DNS problem that isn't
 * there when the operator simply switched the host off.
 */

import { describe, expect, it } from "vite-plus/test";

import { domainStatusFor } from "../domain-rules";

describe("domainStatusFor", () => {
  it("serves only when the system gate is open and the operator hasn't paused", () => {
    expect(domainStatusFor({ enabled: true, disabledByUser: false })).toBe("live");
  });

  it("reads disabled when only the system gate is closed", () => {
    expect(domainStatusFor({ enabled: false, disabledByUser: false })).toBe("disabled");
  });

  it("reads paused when the operator switched it off", () => {
    expect(domainStatusFor({ enabled: true, disabledByUser: true })).toBe("paused");
  });

  it("the pause outranks the system gate — both closed still reads paused", () => {
    // The operator's choice is the one they can act on from this row; the
    // system state comes back on its own once they resume.
    expect(domainStatusFor({ enabled: false, disabledByUser: true })).toBe("paused");
  });
});
