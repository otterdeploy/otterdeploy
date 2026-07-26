import { describe, expect, it } from "vite-plus/test";

import {
  classifyControlPlaneReadiness,
  type ControlPlaneReadinessInput,
} from "../control-plane-readiness";

const NOW = new Date("2026-07-26T12:00:00Z");

/** A fully-green baseline — every test that expects `ready` starts here
 *  unmodified; every test that expects a degradation flips exactly one field
 *  off the baseline, so each test proves that ONE signal alone is enough to
 *  pull the verdict down (the "never fake green" guarantee). */
function baseline(overrides: Partial<ControlPlaneReadinessInput> = {}): ControlPlaneReadinessInput {
  return {
    now: NOW,
    backupEnabled: true,
    destinationConfigured: true,
    destinationReachable: true,
    recoveryKeyExportedAt: new Date("2026-07-20T00:00:00Z"),
    lastSuccessfulBackupAt: new Date("2026-07-26T06:00:00Z"), // 6h ago
    mostRecentRunStatus: "succeeded",
    mostRecentRunAt: new Date("2026-07-26T06:00:00Z"),
    ...overrides,
  };
}

describe("classifyControlPlaneReadiness", () => {
  it("is ready when every real signal is green", () => {
    const result = classifyControlPlaneReadiness(baseline());
    expect(result.level).toBe("ready");
    expect(result.reasons).toEqual([]);
    expect(result.lastBackupAgeHours).toBeCloseTo(6, 1);
  });

  it("is not_ready when backups are disabled, even if everything else is green", () => {
    const result = classifyControlPlaneReadiness(baseline({ backupEnabled: false }));
    expect(result.level).toBe("not_ready");
    expect(result.reasons.join(" ")).toMatch(/turned off/);
  });

  it("is not_ready when no destination is configured", () => {
    const result = classifyControlPlaneReadiness(
      baseline({ destinationConfigured: false, destinationReachable: null }),
    );
    expect(result.level).toBe("not_ready");
    expect(result.reasons.join(" ")).toMatch(/no off-host backup destination/);
  });

  it("is not_ready when the destination is configured but unreachable", () => {
    const result = classifyControlPlaneReadiness(baseline({ destinationReachable: false }));
    expect(result.level).toBe("not_ready");
    expect(result.reasons.join(" ")).toMatch(/not reachable/);
  });

  it("is degraded (not not_ready) when reachability is simply unknown", () => {
    const result = classifyControlPlaneReadiness(baseline({ destinationReachable: null }));
    expect(result.level).toBe("degraded");
    expect(result.reasons.join(" ")).toMatch(/has not been verified/);
  });

  it("is not_ready when the recovery key was never exported", () => {
    const result = classifyControlPlaneReadiness(baseline({ recoveryKeyExportedAt: null }));
    expect(result.level).toBe("not_ready");
    expect(result.reasons.join(" ")).toMatch(/no recovery key has been exported/);
  });

  it("is not_ready when there has never been a successful backup", () => {
    const result = classifyControlPlaneReadiness(
      baseline({ lastSuccessfulBackupAt: null, mostRecentRunStatus: null, mostRecentRunAt: null }),
    );
    expect(result.level).toBe("not_ready");
    expect(result.reasons.join(" ")).toMatch(/never been a successful/);
    expect(result.lastBackupAgeHours).toBeNull();
  });

  it("is degraded when the last successful backup is stale but under the hard ceiling", () => {
    const result = classifyControlPlaneReadiness(
      baseline({ lastSuccessfulBackupAt: new Date("2026-07-25T00:00:00Z") }), // 36h ago
    );
    expect(result.level).toBe("degraded");
    expect(result.reasons.join(" ")).toMatch(/36h ago/);
  });

  it("is not_ready when the last successful backup is beyond the RPO ceiling", () => {
    const result = classifyControlPlaneReadiness(
      baseline({ lastSuccessfulBackupAt: new Date("2026-07-20T00:00:00Z") }), // ~6 days ago
    );
    expect(result.level).toBe("not_ready");
    expect(result.reasons.join(" ")).toMatch(/day\(s\) ago — beyond the recovery-point objective/);
  });

  it("is degraded when the most recent attempt failed even though an earlier one succeeded", () => {
    const result = classifyControlPlaneReadiness(
      baseline({
        mostRecentRunStatus: "failed",
        mostRecentRunAt: new Date("2026-07-26T11:00:00Z"),
      }),
    );
    expect(result.level).toBe("degraded");
    expect(result.reasons.join(" ")).toMatch(/most recent backup attempt failed/);
  });

  it("treats a future-dated last-backup timestamp as unknown, not extra-fresh", () => {
    const result = classifyControlPlaneReadiness(
      baseline({ lastSuccessfulBackupAt: new Date("2026-07-27T00:00:00Z") }),
    );
    expect(result.level).toBe("degraded");
    expect(result.lastBackupAgeHours).toBeNull();
    expect(result.reasons.join(" ")).toMatch(/clock skew|future/i);
  });

  it("accumulates every applicable reason rather than stopping at the first", () => {
    const result = classifyControlPlaneReadiness(
      baseline({
        backupEnabled: false,
        destinationConfigured: false,
        destinationReachable: null,
        recoveryKeyExportedAt: null,
      }),
    );
    expect(result.level).toBe("not_ready");
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });
});
