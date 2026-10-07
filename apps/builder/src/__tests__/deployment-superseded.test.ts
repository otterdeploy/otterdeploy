/**
 * A build whose deployment was cancelled (or settled by another writer) while
 * it ran stops as superseded, not as a failure.
 *
 * markBuilding / markRunning only move a row that is still pending/building
 * and report whether they did. A refused claim or settle ends the build as a
 * DeploymentSupersededError: the row already says what happened, so nothing
 * marks it failed and no build.failed notice goes out. The row writes are
 * stood in for here; their SQL guard is the same one the API's deployment
 * writes use.
 */
import { createId, type DeploymentId, ID_PREFIX } from "@otterdeploy/shared/id";
import { mock } from "bun:test";
import { beforeEach, describe, expect, test } from "vite-plus/test";

import type { LogSink } from "../log-stream";

// The pipeline's modules validate the server env when first imported; nothing
// here connects to anything. `??=` so a configured value always wins.
/* oxlint-disable node/no-process-env -- test env boundary: satisfies the env schema before the dynamic imports below */
process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:1";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123456789";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
/* oxlint-enable node/no-process-env */

const markFailed = mock(async (_id: DeploymentId, _message: string) => undefined);
const emitPlatformEvent = mock(async () => undefined);

await mock.module("../state", () => ({
  markBuilding: mock(async () => true),
  markRunning: mock(async () => true),
  markImageReady: mock(async () => undefined),
  markFailed,
}));
await mock.module("@otterdeploy/api/notifications/emit", () => ({ emitPlatformEvent }));

const { BuildStepError, DeploymentSupersededError } = await import("../errors");
const { handleFailure, transitionStep } = await import("../pipeline-steps");

const deploymentId = createId(ID_PREFIX.deployment);

function recordingSink(): LogSink & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    write: (_stream, line) => lines.push(line),
    system: (line) => lines.push(line),
    setPhase: () => undefined,
    close: async () => undefined,
  };
}

beforeEach(() => {
  markFailed.mockClear();
  emitPlatformEvent.mockClear();
});

describe("transitionStep", () => {
  test("passes when the row took the write", async () => {
    const result = await transitionStep("mark-building", deploymentId, async () => true);
    expect(result.isOk()).toBe(true);
  });

  test("a refused write ends the build as superseded", async () => {
    const result = await transitionStep("mark-running", deploymentId, async () => false);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error).toBeInstanceOf(DeploymentSupersededError);
    expect(result.error.message).toContain("mark-running");
  });

  test("a write that throws is still a build step failure", async () => {
    const result = await transitionStep("mark-building", deploymentId, async () => {
      throw new Error("connection reset");
    });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error).toBeInstanceOf(BuildStepError);
  });
});

describe("handleFailure", () => {
  test("a superseded build marks nothing failed and announces nothing", async () => {
    const sink = recordingSink();
    await handleFailure(
      deploymentId,
      sink,
      new DeploymentSupersededError({ deploymentId, step: "mark-building" }),
    );
    expect(markFailed).not.toHaveBeenCalled();
    expect(emitPlatformEvent).not.toHaveBeenCalled();
    expect(sink.lines.some((line) => line.startsWith("build stopped:"))).toBe(true);
  });
});
