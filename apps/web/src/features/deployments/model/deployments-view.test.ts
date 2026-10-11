import { Temporal } from "@otterdeploy/shared/temporal";
import { describe, expect, test } from "vite-plus/test";

import { formatDuration } from "@/shared/lib/duration";

import { isRollbackEligible, type ProjectDeployment } from "../data/deployments-search";
import {
  byLine,
  changeOf,
  dayTotals,
  failureSentence,
  groupByDay,
  inFlightStep,
  inStatusView,
  startedFormat,
  statusWord,
} from "./deployments-view";

const ZONE = "Europe/London";

function dep(over: Partial<ProjectDeployment> = {}): ProjectDeployment {
  return {
    id: "dep_1",
    projectId: "prj_1",
    resourceId: "res_web",
    resourceName: "web",
    resourceKind: "service",
    environmentName: "production",
    image: "registry.internal/shop/web:a8d3f19",
    reason: "git-push",
    status: "superseded",
    errorMessage: null,
    gitSha: "a8d3f19c0ffee",
    gitRef: "refs/heads/main",
    gitCommitMessage: "Lazy-load product gallery images\n\nbody",
    gitCommitAuthor: "Priya",
    gitCommitAuthorAvatar: null,
    sourceSha: null,
    triggeredBy: null,
    isLatest: false,
    isServing: false,
    completedAt: "2026-10-11T12:01:00Z",
    createdAt: "2026-10-11T12:00:00Z",
    updatedAt: "2026-10-11T12:01:00Z",
    ...over,
  };
}

describe("formatDuration: one format everywhere", () => {
  test("seconds alone under a minute, minutes with padded seconds above", () => {
    expect(formatDuration(9_000)).toBe("9s");
    expect(formatDuration(64_000)).toBe("1m 04s");
    expect(formatDuration(60_000)).toBe("1m 00s");
    expect(formatDuration(134_000)).toBe("2m 14s");
  });

  test("hours with padded minutes", () => {
    expect(formatDuration(3_780_000)).toBe("1h 03m");
    expect(formatDuration(3_600_000)).toBe("1h 00m");
  });

  test("never negative", () => {
    expect(formatDuration(-5_000)).toBe("0s");
  });
});

describe("status views", () => {
  test("Live now shows the deploy each resource is serving, whatever its status", () => {
    expect(inStatusView(dep({ status: "running", isServing: true }), "live")).toBe(true);
    expect(inStatusView(dep({ status: "crashed", isServing: true }), "live")).toBe(true);
    // The newest row while it is still rolling out is not live.
    expect(inStatusView(dep({ status: "starting", isLatest: true }), "live")).toBe(false);
  });

  test("In progress is queued, building and deploying", () => {
    for (const status of ["pending", "building", "starting"] as const) {
      expect(inStatusView(dep({ status }), "progress")).toBe(true);
    }
    expect(inStatusView(dep({ status: "cancelled" }), "progress")).toBe(false);
  });

  test("Failed is everything that broke, and nothing that was stopped on purpose", () => {
    expect(inStatusView(dep({ status: "failed" }), "failed")).toBe(true);
    expect(inStatusView(dep({ status: "crashed" }), "failed")).toBe(true);
    expect(inStatusView(dep({ status: "cancelled" }), "failed")).toBe(false);
  });

  test("the serving row reads Live; a still-rolling newer one does not", () => {
    expect(statusWord(dep({ status: "running", isServing: true }))).toBe("Live");
    expect(statusWord(dep({ status: "starting", isLatest: true }))).toBe("Deploying");
  });
});

describe("day grouping", () => {
  const now = Temporal.Instant.from("2026-10-11T15:00:00Z");

  test("groups consecutive rows by calendar day in the viewer's zone, newest first", () => {
    const rows = [
      dep({ id: "a", createdAt: "2026-10-11T14:18:00Z" }),
      // 23:30 UTC on the 10th is 00:30 on the 11th in London (BST): today.
      dep({ id: "b", createdAt: "2026-10-10T23:30:00Z" }),
      dep({ id: "c", createdAt: "2026-10-10T18:40:00Z" }),
      dep({ id: "d", createdAt: "2026-10-06T22:30:00Z" }),
    ];
    const groups = groupByDay(rows, now, ZONE);
    expect(groups.map((g) => [g.key, g.relative, g.items.map((r) => r.id)])).toEqual([
      ["2026-10-11", "Today", ["a", "b"]],
      ["2026-10-10", "Yesterday", ["c"]],
      ["2026-10-06", null, ["d"]],
    ]);
  });

  test("a day's totals count every deploy that day, failures included", () => {
    const totals = dayTotals(
      [
        dep({ createdAt: "2026-10-11T14:18:00Z", status: "failed" }),
        dep({ createdAt: "2026-10-11T13:00:00Z", status: "crashed" }),
        dep({ createdAt: "2026-10-11T12:00:00Z" }),
        dep({ createdAt: "2026-10-10T12:00:00Z" }),
      ],
      ZONE,
    );
    expect(totals.get("2026-10-11")).toEqual({ total: 3, failed: 2 });
    expect(totals.get("2026-10-10")).toEqual({ total: 1, failed: 0 });
  });

  test("Started names the day whenever the row is not from today", () => {
    expect(startedFormat("2026-10-11T09:00:00Z", now, ZONE)).toBe("time");
    expect(startedFormat("2026-10-10T18:40:00Z", now, ZONE)).toBe("weekday-time");
    expect(startedFormat("2026-10-05T18:40:00Z", now, ZONE)).toBe("weekday-time");
    expect(startedFormat("2026-10-04T18:40:00Z", now, ZONE)).toBe("date-time");
  });
});

describe("By: who did it", () => {
  test("a push is credited to its author, with the branch", () => {
    const { actor, verb } = byLine(dep());
    expect(actor).toMatchObject({ kind: "person", name: "Priya" });
    expect(verb).toBe("pushed to main");
  });

  test("a rollback is credited to whoever rolled back, not the commit's author", () => {
    const { actor, verb } = byLine(
      dep({ reason: "rollback", triggeredBy: { name: "Ada", image: null } }),
    );
    expect(actor).toMatchObject({ kind: "person", name: "Ada" });
    expect(verb).toBe("rolled back");
  });

  test("no person behind it reads as automatic, never as the commit's author", () => {
    const { actor, verb } = byLine(dep({ reason: "redeploy", gitCommitAuthor: "Marcus" }));
    expect(actor.kind).toBe("automatic");
    expect(verb).toBe("redeployed");
  });
});

describe("in flight and failed", () => {
  test("an in-flight deploy names its step out of the pipeline's four", () => {
    expect(inFlightStep(dep({ status: "pending" }))).toEqual({ step: 1, of: 4 });
    expect(inFlightStep(dep({ status: "building" }))).toEqual({ step: 2, of: 4 });
    expect(inFlightStep(dep({ status: "starting" }))).toEqual({ step: 3, of: 4 });
    expect(inFlightStep(dep({ status: "running" }))).toBeNull();
  });

  test("a failed build says what the resource kept serving", () => {
    const serving = { gitSha: "a8d3f19c0ffee", sourceSha: null, image: "x" };
    const failed = dep({ status: "failed", image: "pending:c27d9e3", isLatest: true });
    expect(failureSentence(failed, serving)).toEqual({
      lead: "Failed during the build.",
      kept: { resource: "web", ref: "a8d3f19" },
    });
    expect(statusWord(failed)).toBe("Build failed");
  });

  test("an older failure does not claim today's serving deploy as what it kept", () => {
    const serving = { gitSha: "a8d3f19c0ffee", sourceSha: null, image: "x" };
    const old = dep({ status: "failed", isLatest: false });
    expect(failureSentence(old, serving)).toEqual({ lead: "Failed during rollout.", kept: null });
    expect(statusWord(old)).toBe("Deploy failed");
  });

  test("rollback is never offered to the deploy already serving", () => {
    expect(isRollbackEligible(dep({ status: "running", isServing: true }))).toBe(false);
    expect(isRollbackEligible(dep({ status: "superseded" }))).toBe(true);
  });
});

describe("Change", () => {
  test("a commit reads as its subject, with the short sha and branch", () => {
    expect(changeOf(dep())).toMatchObject({
      title: "Lazy-load product gallery images",
      sha: "a8d3f19",
      branch: "main",
    });
  });

  test("an image deploy reads as its tag, in mono", () => {
    expect(
      changeOf(
        dep({
          gitSha: null,
          gitCommitMessage: null,
          gitRef: null,
          image: "redis:8.2-alpine",
          reason: "image-change",
        }),
      ),
    ).toMatchObject({ title: "redis:8.2-alpine", titleMono: true });
  });
});
