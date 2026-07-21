import { describe, expect, test } from "vite-plus/test";

import type { InstanceGlimpse } from "../deployments-derive";

import { deriveDeploymentStatus, ZERO_TASK_STALE_MS } from "../deployments-derive";

const glimpse = (overrides: Partial<InstanceGlimpse> & { state: string }): InstanceGlimpse => ({
  exitCode: null,
  restartCount: null,
  oomKilled: null,
  ...overrides,
});

const fresh = () => new Date();
const stale = () => new Date(Date.now() - ZERO_TASK_STALE_MS - 1000);

describe("deriveDeploymentStatus", () => {
  test("healthy running deployment stays running", () => {
    const status = deriveDeploymentStatus(
      "running",
      true,
      [glimpse({ state: "running" })],
      fresh(),
      false,
      false,
    );
    expect(status).toBe("running");
  });

  // ─── crash detection ─────────────────────────────────────────────────

  test("retry-exhausted plain-docker container (exited non-zero) is crashed, not running", () => {
    // docker on-failure gave up after the cap: ONE exited container remains.
    const status = deriveDeploymentStatus(
      "running",
      true,
      [glimpse({ state: "exited", exitCode: 1, restartCount: 5 })],
      fresh(),
      false,
      false,
    );
    expect(status).toBe("crashed");
  });

  test("OOM-killed container is crashed even with exit code null", () => {
    const status = deriveDeploymentStatus(
      "running",
      true,
      [glimpse({ state: "exited", oomKilled: true })],
      fresh(),
      false,
      false,
    );
    expect(status).toBe("crashed");
  });

  test("exited(0) after restarts (crash-loop of a clean-exit cmd) is crashed", () => {
    const status = deriveDeploymentStatus(
      "running",
      true,
      [glimpse({ state: "exited", exitCode: 0, restartCount: 3 })],
      fresh(),
      false,
      false,
    );
    expect(status).toBe("crashed");
  });

  test("actively restarting container is crashed (docker restart-loop signal)", () => {
    const status = deriveDeploymentStatus(
      "running",
      true,
      [glimpse({ state: "restarting" })],
      fresh(),
      false,
      false,
    );
    expect(status).toBe("crashed");
  });

  test("swarm crash loop (>=3 failed tasks) alongside a running task is crashed", () => {
    const status = deriveDeploymentStatus(
      "running",
      true,
      [
        glimpse({ state: "running" }),
        glimpse({ state: "failed", exitCode: 1 }),
        glimpse({ state: "failed", exitCode: 1 }),
        glimpse({ state: "failed", exitCode: 1 }),
      ],
      fresh(),
      false,
      false,
    );
    expect(status).toBe("crashed");
  });

  // ─── NOT crashes ─────────────────────────────────────────────────────

  test("operator stop (clean exit 0, no restarts) keeps the stored running status", () => {
    // e.g. a stopped database — must not read as crashed.
    const status = deriveDeploymentStatus(
      "running",
      true,
      [glimpse({ state: "exited", exitCode: 0, restartCount: 0 })],
      fresh(),
      false,
      false,
    );
    expect(status).toBe("running");
  });

  test("lone swarm task failure with a replacement coming up stays running", () => {
    const status = deriveDeploymentStatus(
      "running",
      true,
      [glimpse({ state: "failed", exitCode: 1 }), glimpse({ state: "preparing" })],
      fresh(),
      false,
      false,
    );
    expect(status).toBe("running");
  });

  // ─── build/startup phases ────────────────────────────────────────────

  test("stored building with a pre-running task is starting", () => {
    const status = deriveDeploymentStatus(
      "building",
      true,
      [glimpse({ state: "starting" })],
      fresh(),
      false,
      false,
    );
    expect(status).toBe("starting");
  });

  test("fresh zero-task building row stays building", () => {
    const status = deriveDeploymentStatus("building", true, [], fresh(), false, false);
    expect(status).toBe("building");
  });

  test("stale zero-task building row with no build output is failed", () => {
    const status = deriveDeploymentStatus("building", true, [], stale(), false, false);
    expect(status).toBe("failed");
  });

  test("stale zero-task building row with an active build log stays building", () => {
    const status = deriveDeploymentStatus("building", true, [], stale(), true, false);
    expect(status).toBe("building");
  });

  test("stale zero-task pending row is failed (enqueue died)", () => {
    const status = deriveDeploymentStatus("pending", true, [], stale(), false, false);
    expect(status).toBe("failed");
  });

  // ─── history rows ────────────────────────────────────────────────────

  test("non-latest row with no tasks is superseded", () => {
    const status = deriveDeploymentStatus("running", false, [], fresh(), false, false);
    expect(status).toBe("superseded");
  });

  test("non-latest FAILED row with no tasks stays failed (superseded must not hide a failure)", () => {
    const status = deriveDeploymentStatus("failed", false, [], fresh(), false, false);
    expect(status).toBe("failed");
  });

  test("non-latest FAILED row with lingering non-running tasks stays failed", () => {
    const status = deriveDeploymentStatus(
      "failed",
      false,
      [glimpse({ state: "exited", exitCode: 1 })],
      fresh(),
      false,
      false,
    );
    expect(status).toBe("failed");
  });

  test("non-latest row whose tasks all failed reads failed, not superseded", () => {
    const status = deriveDeploymentStatus(
      "building",
      false,
      [glimpse({ state: "failed", exitCode: 1 })],
      fresh(),
      false,
      false,
    );
    expect(status).toBe("failed");
  });

  test("stored failed never rewinds to starting while docker still bounces the container", () => {
    const status = deriveDeploymentStatus(
      "failed",
      true,
      [glimpse({ state: "restarting" })],
      fresh(),
      false,
      false,
    );
    expect(status).toBe("crashed");
  });

  test("latest build-phase row whose only task failed is failed", () => {
    const status = deriveDeploymentStatus(
      "building",
      true,
      [glimpse({ state: "failed", exitCode: 1 })],
      fresh(),
      false,
      false,
    );
    expect(status).toBe("failed");
  });

  // ─── paused ──────────────────────────────────────────────────────────

  test("paused latest service reads paused, overriding the stale running status", () => {
    // Pausing scales to zero, so the (formerly running) task is gone. Without
    // the pause override this derives back to the stored "running".
    const status = deriveDeploymentStatus("running", true, [], fresh(), false, true);
    expect(status).toBe("paused");
  });

  test("paused overrides even a still-lingering running task on the latest row", () => {
    const status = deriveDeploymentStatus(
      "running",
      true,
      [glimpse({ state: "running" })],
      fresh(),
      false,
      true,
    );
    expect(status).toBe("paused");
  });

  test("paused only applies to the latest row — history keeps its real outcome", () => {
    const status = deriveDeploymentStatus("running", false, [], fresh(), false, true);
    expect(status).toBe("superseded");
  });
});
