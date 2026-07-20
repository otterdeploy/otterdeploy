import { describe, expect, test } from "vite-plus/test";

import { resolveTaskStatus } from "../internals";

/**
 * Guards the false-success bug: a compose/service deploy whose image can't be
 * pulled leaves swarm churning through failing tasks. The *newest* task is often
 * a fresh "preparing" retry (which reads as "starting"), so sampling only the
 * latest task made a broken rollout look like it was still coming up — and the
 * reconcile then marked the deployment "running" over an empty shell.
 * resolveTaskStatus must instead surface the most recent hard failure's reason.
 */
describe("resolveTaskStatus", () => {
  const task = (state: string, createdAt: string, err?: string) => ({
    CreatedAt: createdAt,
    Status: { State: state, ...(err ? { Err: err } : {}) },
  });

  test("a running task wins, even alongside an older failed one", () => {
    const out = resolveTaskStatus([
      task("rejected", "2026-01-01T00:00:00Z", "No such image: x"),
      task("running", "2026-01-01T00:01:00Z"),
    ]);
    expect(out).toEqual({ status: "running", errorMessage: null });
  });

  test("reports error with the pull reason when the newest task is a fresh retry", () => {
    // Swarm order in the wild: an older task rejected on the pull, a newer one
    // already re-created and sitting in "preparing" — the exact race the bug hit.
    const out = resolveTaskStatus([
      task("rejected", "2026-01-01T00:00:00Z", "pull access denied for otterdeploy-local/waves"),
      task("preparing", "2026-01-01T00:00:05Z"),
    ]);
    expect(out.status).toBe("error");
    expect(out.errorMessage).toBe("pull access denied for otterdeploy-local/waves");
  });

  test("surfaces the error when the latest task itself is rejected", () => {
    const out = resolveTaskStatus([task("rejected", "2026-01-01T00:00:00Z", "No such image: x")]);
    expect(out).toEqual({ status: "error", errorMessage: "No such image: x" });
  });

  test("a genuinely still-starting service with no failures stays starting", () => {
    const out = resolveTaskStatus([
      task("preparing", "2026-01-01T00:00:00Z"),
      task("pending", "2026-01-01T00:00:02Z"),
    ]);
    expect(out).toEqual({ status: "starting", errorMessage: null });
  });

  test("a failed state without a reason still reads as error (no message)", () => {
    const out = resolveTaskStatus([task("failed", "2026-01-01T00:00:00Z")]);
    // No Err on the task → the failure isn't surfaced as the chosen one, so the
    // status falls back to the latest task's mapping ("error" via mapTaskState).
    expect(out.status).toBe("error");
    expect(out.errorMessage).toBeNull();
  });

  test("no tasks → missing", () => {
    expect(resolveTaskStatus([])).toEqual({ status: "missing", errorMessage: null });
  });
});
