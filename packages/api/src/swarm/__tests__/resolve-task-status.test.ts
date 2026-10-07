import { Temporal } from "@otterdeploy/shared/temporal";
import { describe, expect, test } from "vite-plus/test";

import { resolveTaskStatus } from "../internals";
import { IMAGE_PULL_STALL_MS, pullingImage } from "../task-status";

/**
 * Guards the false-success bug: a compose/service deploy whose image can't be
 * pulled leaves swarm churning through failing tasks. The *newest* task is often
 * a fresh "preparing" retry (which reads as "starting"), so sampling only the
 * latest task made a broken rollout look like it was still coming up, and the
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
    // already re-created and sitting in "preparing", the exact race the bug hit.
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

  describe("a pull that hangs", () => {
    const at = (iso: string) => Temporal.Instant.from(iso).epochMilliseconds;
    const pulling = (since: string) => ({
      CreatedAt: since,
      Status: { State: "preparing", Timestamp: since },
      Spec: { ContainerSpec: { Image: "traefik/whoami:v1.11@sha256:abc" } },
    });
    const old = task("running", "2026-01-01T00:00:00Z");

    test("inside the bound it is still starting", () => {
      const out = resolveTaskStatus(
        [old, pulling("2026-01-01T00:10:00Z")],
        at("2026-01-01T00:12:00Z"),
      );
      expect(out).toEqual({ status: "starting", errorMessage: null });
    });

    test("past the bound it is an error that names the image and the registry", () => {
      const since = "2026-01-01T00:10:00Z";
      const now = at(since) + IMAGE_PULL_STALL_MS + 60_000;
      const out = resolveTaskStatus([old, pulling(since)], now);
      expect(out.status).toBe("error");
      expect(out.errorMessage).toBe(
        "image traefik/whoami:v1.11 has not finished pulling after 4 min on its node: check that the node can reach the image's registry",
      );
    });

    test("a task's own failure reason still wins over the stall note", () => {
      const out = resolveTaskStatus(
        [
          task("rejected", "2026-01-01T00:00:00Z", "No such image: x"),
          pulling("2026-01-01T00:00:05Z"),
        ],
        at("2026-01-01T01:00:00Z"),
      );
      expect(out).toEqual({ status: "error", errorMessage: "No such image: x" });
    });
  });

  describe("pullingImage (what a timed-out rollout was still doing)", () => {
    test("names the image the newest task is pulling, digest dropped", () => {
      expect(
        pullingImage([
          task("running", "2026-01-01T00:00:00Z"),
          {
            CreatedAt: "2026-01-01T00:01:00Z",
            Status: { State: "preparing" },
            Spec: { ContainerSpec: { Image: "traefik/whoami:v1.11@sha256:abc" } },
          },
        ]),
      ).toBe("traefik/whoami:v1.11");
    });

    test("is null once the newest task got past its pull", () => {
      expect(pullingImage([task("starting", "2026-01-01T00:01:00Z")])).toBeNull();
    });
  });
});
