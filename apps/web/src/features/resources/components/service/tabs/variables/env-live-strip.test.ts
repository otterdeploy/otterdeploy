/**
 * The Variables tab says whether a saved change is live, the same way for
 * both save paths.
 */
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/shared/server/orpc", () => ({ orpc: {}, queryClient: {} }));
vi.mock("@/features/projects/components/use-pending-changes", () => ({
  usePendingChanges: vi.fn(),
}));
vi.mock("@/features/shell/use-active-environment", () => ({ useActiveEnvironment: vi.fn() }));
vi.mock("../../use-live-service", () => ({ useLiveService: vi.fn() }));

const { envStripState, stagedEnvCount } = await import("./env-live-strip");

const live = { state: "live" as const, appliedAt: "2026-10-07T12:03:00Z" };

describe("stagedEnvCount", () => {
  it("counts only this service's staged variable edits", () => {
    const changes = [
      { kind: "create", resource: "env", name: "web.FLAG", details: { owner: "web", key: "FLAG" } },
      { kind: "update", resource: "env", name: "api.X", details: { owner: "api", key: "X" } },
      { kind: "update", resource: "service", name: "web" },
      { kind: "no-op", resource: "env", name: "web.Y", details: { owner: "web" } },
      // An older server without `owner`: the dotted name still says whose it is.
      { kind: "delete", resource: "env", name: "web.OLD" },
    ];
    expect(stagedEnvCount(changes, "web")).toBe(2);
  });
});

describe("envStripState", () => {
  it("a staged change waits for Apply and restart, whatever the service says", () => {
    expect(envStripState({ stagedCount: 1, liveness: live, working: false })).toEqual({
      kind: "staged",
      count: 1,
    });
  });

  it("a saved change the container has not read is pending", () => {
    expect(
      envStripState({
        stagedCount: 0,
        liveness: { state: "pending", appliedAt: null },
        working: false,
      }),
    ).toEqual({ kind: "pending" });
  });

  it("says when the values went live", () => {
    expect(envStripState({ stagedCount: 0, liveness: live, working: false })).toEqual({
      kind: "live",
      sinceMs: Date.UTC(2026, 9, 7, 12, 3),
    });
  });

  it("shows the roll while it runs", () => {
    expect(envStripState({ stagedCount: 1, liveness: live, working: true })).toEqual({
      kind: "applying",
    });
  });

  it("draws nothing it cannot vouch for", () => {
    expect(
      envStripState({
        stagedCount: 0,
        liveness: { state: "unknown", appliedAt: null },
        working: false,
      }),
    ).toEqual({ kind: "none" });
    expect(envStripState({ stagedCount: 0, liveness: undefined, working: false })).toEqual({
      kind: "none",
    });
  });
});
