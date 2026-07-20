import { describe, expect, test } from "vitest";

import { computeStages, type ProvisionStageRow } from "./server-provision-stepper";

const keyAuthRow = (overrides: Partial<ProvisionStageRow> = {}): ProvisionStageRow => ({
  provisionStatus: "provisioning",
  provisionError: null,
  sshKeyId: "sshkey_1",
  meshProvider: "none",
  buildServer: false,
  ...overrides,
});

const stateOf = (stages: ReturnType<typeof computeStages>, key: string) =>
  stages.find((s) => s.key === key)?.state;

describe("computeStages", () => {
  test("key-auth run shows the core stages, no managed-key/mesh/label steps", () => {
    const stages = computeStages([], keyAuthRow());
    expect(stages.map((s) => s.key)).toEqual([
      "connect",
      "probe",
      "prereqs",
      "docker",
      "swarm",
      "verify",
      "ready",
    ]);
  });

  test("password-auth run inserts the managed-SSH-key stage", () => {
    const stages = computeStages([], keyAuthRow({ sshKeyId: null }));
    expect(stages.map((s) => s.key)).toContain("ssh-key");
  });

  test("mesh + build config surface their optional stages", () => {
    const stages = computeStages([], keyAuthRow({ meshProvider: "tailscale", buildServer: true }));
    expect(stages.map((s) => s.key)).toContain("mesh");
    expect(stages.map((s) => s.key)).toContain("label");
  });

  test("markers seen so far mark prior stages done and the latest active", () => {
    const lines = [
      "── connecting to 203.0.113.7:22 as root ──",
      "── probing host ──",
      "── installing prerequisites ──",
    ];
    const stages = computeStages(lines, keyAuthRow());
    expect(stateOf(stages, "connect")).toBe("done");
    expect(stateOf(stages, "probe")).toBe("done");
    expect(stateOf(stages, "prereqs")).toBe("active");
    expect(stateOf(stages, "docker")).toBe("pending");
  });

  test("a ✓ terminal line marks every stage done", () => {
    const lines = ["── connecting to h ──", "✓ server ready"];
    const stages = computeStages(lines, keyAuthRow({ provisionStatus: "ready" }));
    expect(stages.every((s) => s.state === "done")).toBe(true);
  });

  test("a ✗ terminal line fails the active stage", () => {
    const lines = [
      "── connecting to h ──",
      "── installing Docker ──",
      "✗ provisioning failed: boom",
    ];
    const stages = computeStages(lines, keyAuthRow({ provisionStatus: "failed" }));
    expect(stateOf(stages, "docker")).toBe("failed");
    expect(stateOf(stages, "prereqs")).toBe("done");
    expect(stateOf(stages, "swarm")).toBe("pending");
  });

  test("DB failed status alone (no log lines) still resolves, not an eternal spinner", () => {
    // The race case: the stream missed everything, but the row recorded failure.
    const stages = computeStages([], keyAuthRow({ provisionStatus: "failed" }));
    expect(stages.some((s) => s.state === "active")).toBe(false);
    expect(stages.every((s) => s.state === "pending")).toBe(true);
  });

  test("DB ready status alone marks everything done", () => {
    const stages = computeStages([], keyAuthRow({ provisionStatus: "ready" }));
    expect(stages.every((s) => s.state === "done")).toBe(true);
  });

  test("in-flight row with no markers yet shows the first stage active", () => {
    const stages = computeStages([], keyAuthRow({ provisionStatus: "joining" }));
    expect(stages[0]?.state).toBe("active");
  });
});
