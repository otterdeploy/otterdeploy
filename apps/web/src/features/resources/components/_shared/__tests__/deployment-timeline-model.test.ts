/**
 * A `running` deployment is not automatically a successful one.
 *
 * The incident these pin: a service came up, failed its healthcheck, and sat at
 * `Up 14 minutes (unhealthy)` 404-ing every request — while the deployment view
 * showed "Deployed successfully" over four green checks. The contradicting
 * rollup was already on the row (`runningTaskCount` vs `taskCount`); the
 * timeline simply never read it.
 */

import { describe, expect, it } from "vite-plus/test";

import type { TimelineInput } from "../deployment-timeline-model";

import { buildTimeline } from "../deployment-timeline-model";

const base: TimelineInput = {
  status: "running",
  errorMessage: null,
  taskCount: 1,
  runningTaskCount: 1,
  completedAt: "2026-07-30T10:00:30.000Z",
  createdAt: "2026-07-30T10:00:00.000Z",
};

describe("buildTimeline — running", () => {
  it("reports success when every replica is running", () => {
    const t = buildTimeline(base);
    expect(t.title).toBe("Deployed successfully");
    expect(t.tone).toBe("success");
    expect(t.phases.every((p) => p.state === "done")).toBe(true);
  });

  it("does NOT claim success when the only replica is down", () => {
    // The regression, stated directly.
    const t = buildTimeline({ ...base, taskCount: 1, runningTaskCount: 0 });
    expect(t.tone).toBe("degraded");
    expect(t.title).toBe("Deployed, but no replicas are running");
    expect(t.title).not.toContain("successfully");
  });

  it("counts the shortfall when only some replicas are down", () => {
    const t = buildTimeline({ ...base, taskCount: 3, runningTaskCount: 1 });
    expect(t.tone).toBe("degraded");
    expect(t.title).toBe("Deployed, but 2 of 3 replicas are not running");
  });

  it("marks post-deploy failed, not done, and says where to look", () => {
    const t = buildTimeline({ ...base, taskCount: 2, runningTaskCount: 0 });
    const run = t.phases.find((p) => p.key === "run");
    expect(run?.state).toBe("failed");
    expect(run?.detail).toContain("0/2 replicas running");
    // The earlier phases genuinely did succeed — don't retro-fail the build.
    expect(t.phases.find((p) => p.key === "build")?.state).toBe("done");
    expect(t.phases.find((p) => p.key === "deploy")?.state).toBe("done");
  });

  it("treats an absent rollup as no evidence, not as failure", () => {
    // taskCount 0 = nothing reported yet. A brand-new row must not flash a
    // scary degraded state before the first rollup lands.
    const t = buildTimeline({ ...base, taskCount: 0, runningTaskCount: 0 });
    expect(t.tone).toBe("success");
  });

  it("does not go degraded when more replicas run than expected", () => {
    // Mid-rollout overlap (old + new tasks) must not read as a fault.
    const t = buildTimeline({ ...base, taskCount: 2, runningTaskCount: 3 });
    expect(t.tone).toBe("success");
  });

  it("still reports the deployment duration while degraded", () => {
    const t = buildTimeline({ ...base, taskCount: 1, runningTaskCount: 0 });
    expect(t.totalMs).toBe(30_000);
  });
});

describe("buildTimeline — other statuses are unchanged", () => {
  it("keeps the two failure shapes apart", () => {
    const rollout = buildTimeline({ ...base, status: "failed", taskCount: 2 });
    expect(rollout.title).toBe("Deployment failed during rollout");
    const build = buildTimeline({ ...base, status: "failed", taskCount: 0 });
    expect(build.title).toBe("Deployment failed during build process");
  });

  it("does not apply the replica check to non-running statuses", () => {
    // `paused` is scaled to zero on purpose — 0 running replicas is correct.
    const t = buildTimeline({ ...base, status: "paused", runningTaskCount: 0 });
    expect(t.tone).toBe("neutral");
    expect(t.title).toBe("Paused — scaled to zero");
  });
});
