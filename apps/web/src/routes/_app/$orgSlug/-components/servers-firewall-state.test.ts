import { describe, expect, it } from "vite-plus/test";

import { firewallState, summarizeFirewall } from "./servers-firewall-state";

describe("firewallState", () => {
  it("never reads unknown as enforced — the honesty-critical case", () => {
    expect(firewallState({ firewallStatus: "unknown", firewallBouncerActive: false })).toBe(
      "unknown",
    );
    // Even a stray bouncer-active flag on an unknown row must not flip it
    // green — the nftables baseline itself was never established.
    expect(firewallState({ firewallStatus: "unknown", firewallBouncerActive: true })).toBe(
      "unknown",
    );
  });

  it("reads applied + bouncer active as enforced", () => {
    expect(firewallState({ firewallStatus: "applied", firewallBouncerActive: true })).toBe(
      "enforced",
    );
  });

  it("reads applied without an active bouncer as drifted, not enforced", () => {
    expect(firewallState({ firewallStatus: "applied", firewallBouncerActive: false })).toBe(
      "drifted",
    );
  });

  it("reads unsupported + bouncer active as enforced (narrated alt. protection)", () => {
    expect(firewallState({ firewallStatus: "unsupported", firewallBouncerActive: true })).toBe(
      "enforced",
    );
  });

  it("reads unsupported without a bouncer as drifted — neither layer protects the node", () => {
    expect(firewallState({ firewallStatus: "unsupported", firewallBouncerActive: false })).toBe(
      "drifted",
    );
  });

  it("reads a failed apply as drifted regardless of bouncer state", () => {
    expect(firewallState({ firewallStatus: "failed", firewallBouncerActive: true })).toBe(
      "drifted",
    );
    expect(firewallState({ firewallStatus: "failed", firewallBouncerActive: false })).toBe(
      "drifted",
    );
  });
});

describe("summarizeFirewall", () => {
  it("keeps status, bouncer, and drift as separate facts (not collapsed into one badge)", () => {
    const summary = summarizeFirewall({
      firewallStatus: "applied",
      firewallBouncerActive: false,
    });
    expect(summary).toEqual({
      state: "drifted",
      status: "applied",
      bouncerActive: false,
      drifted: true,
    });
  });

  it("reports the bouncer fact independently even on an unknown row", () => {
    const summary = summarizeFirewall({
      firewallStatus: "unknown",
      firewallBouncerActive: true,
    });
    expect(summary.state).toBe("unknown");
    expect(summary.bouncerActive).toBe(true);
    expect(summary.drifted).toBe(true);
  });
});
