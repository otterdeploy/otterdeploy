/**
 * Pure lane-name logic — no Redis, no env. The queue-name mapping is the
 * backward-compatibility contract of the whole lanes feature: the default
 * lane MUST keep the historical bare queue name so jobs enqueued before
 * lanes existed still drain after an upgrade.
 */
import { describe, expect, test } from "bun:test";

import { deployTriggeredJob } from "../jobs/deploy";
import { DEFAULT_DEPLOY_LANE, deployQueueName, isDeployLaneName } from "../lanes";

describe("deployQueueName", () => {
  test("the default lane maps to the bare historical queue name", () => {
    expect(deployQueueName(DEFAULT_DEPLOY_LANE)).toBe("deploy.triggered");
    // Guard the coupling: if the job is ever renamed, the default lane must
    // follow it — this is the same string, not a lookalike literal.
    expect(deployQueueName(DEFAULT_DEPLOY_LANE)).toBe(deployTriggeredJob.name);
  });

  test("a named lane suffixes the queue name", () => {
    expect(deployQueueName("fast")).toBe("deploy.triggered.fast");
    expect(deployQueueName("build-eu-1")).toBe("deploy.triggered.build-eu-1");
  });

  test.each(["", "Fast", "has space", "under_score", "dots.bad", "a".repeat(64), "café"])(
    "rejects invalid lane name %p",
    (lane) => {
      expect(() => deployQueueName(lane)).toThrow(/invalid deploy lane/);
    },
  );
});

describe("isDeployLaneName", () => {
  test("accepts lowercase alphanumerics and hyphens up to 63 chars", () => {
    expect(isDeployLaneName("default")).toBe(true);
    expect(isDeployLaneName("a")).toBe(true);
    expect(isDeployLaneName("build-2")).toBe(true);
    expect(isDeployLaneName("a".repeat(63))).toBe(true);
  });

  test("rejects everything else", () => {
    expect(isDeployLaneName("")).toBe(false);
    expect(isDeployLaneName("A")).toBe(false);
    expect(isDeployLaneName("a".repeat(64))).toBe(false);
    expect(isDeployLaneName("lane!")).toBe(false);
  });
});
