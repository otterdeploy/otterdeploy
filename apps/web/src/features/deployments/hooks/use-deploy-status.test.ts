import { describe, expect, it } from "vite-plus/test";

import { rollupDeployStatus } from "./use-deploy-status";

const NOW = Date.parse("2026-07-26T20:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const row = (status: string, completedAt: string | null = null, createdAt = ago(0)) => ({
  status,
  createdAt,
  completedAt,
});

describe("rollupDeployStatus", () => {
  it("is idle with no deployments at all", () => {
    expect(rollupDeployStatus([], NOW)).toBe("idle");
  });

  it("reports deploying for each in-flight status", () => {
    // These three are the whole reason the hook exists — a build sitting in
    // `building` has no swarm task, so nothing else in the app reports it.
    for (const status of ["pending", "building", "starting"]) {
      expect(rollupDeployStatus([row(status)], NOW)).toBe("deploying");
    }
  });

  it("stays idle for settled statuses", () => {
    for (const status of ["running", "superseded", "removed"]) {
      expect(rollupDeployStatus([row(status)], NOW)).toBe("idle");
    }
  });

  it("reports error for a failure inside the window", () => {
    expect(rollupDeployStatus([row("failed", ago(30_000))], NOW)).toBe("error");
  });

  it("lets an old failure age out instead of pinning the tab red forever", () => {
    // A failed row stays failed in the DB indefinitely; without the window the
    // favicon would stay red until the next successful deploy.
    expect(rollupDeployStatus([row("failed", ago(10 * 60_000))], NOW)).toBe("idle");
  });

  it("falls back to createdAt when a failed row never recorded completedAt", () => {
    expect(rollupDeployStatus([row("failed", null, ago(30_000))], NOW)).toBe("error");
    expect(rollupDeployStatus([row("failed", null, ago(10 * 60_000))], NOW)).toBe("idle");
  });

  it("ignores an unparseable timestamp rather than reporting a false error", () => {
    expect(rollupDeployStatus([row("failed", "not-a-date", "also-not")], NOW)).toBe("idle");
  });

  it("prefers in-flight over a recent failure — the retry is the headline", () => {
    expect(rollupDeployStatus([row("failed", ago(10_000)), row("building")], NOW)).toBe(
      "deploying",
    );
    expect(rollupDeployStatus([row("building"), row("failed", ago(10_000))], NOW)).toBe(
      "deploying",
    );
  });

  it("stops treating an in-flight row as building once it is stranded", () => {
    // A helper that dies before `markBuilding` never converges the row, so it
    // sits in `building` forever. Past the builder's own helper timeout no real
    // build can still be alive, and the tab must stop claiming one is.
    const stranded = { status: "building", createdAt: ago(46 * 60_000), completedAt: null };
    expect(rollupDeployStatus([stranded], NOW)).toBe("idle");
    // Just inside the wall it is still a plausible long build.
    expect(rollupDeployStatus([{ ...stranded, createdAt: ago(44 * 60_000) }], NOW)).toBe(
      "deploying",
    );
  });

  it("a stranded row does not mask a genuine build behind it", () => {
    expect(
      rollupDeployStatus(
        [
          { status: "building", createdAt: ago(46 * 60_000), completedAt: null },
          { status: "building", createdAt: ago(30_000), completedAt: null },
        ],
        NOW,
      ),
    ).toBe("deploying");
  });

  it("an in-flight row with an unparseable timestamp fails open", () => {
    // Opposite of the failure branch: the row claims to be building, and
    // dropping it on a bad date would hide a real deploy from the tab.
    expect(
      rollupDeployStatus([{ status: "building", createdAt: "nonsense", completedAt: null }], NOW),
    ).toBe("deploying");
  });

  it("finds a recent failure behind newer settled rows", () => {
    // The newest deploy succeeding does not erase a failure the operator has
    // not seen yet; only the window does.
    expect(rollupDeployStatus([row("running"), row("failed", ago(20_000))], NOW)).toBe("error");
  });
});
