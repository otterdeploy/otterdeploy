import { describe, expect, it } from "vitest";

import type { PushEvent } from "./types";
import { changedPathsFromPush, matchesWatchPatterns } from "./watch-match";

function push(commits: Partial<PushEvent>): PushEvent {
  return {
    ref: "refs/heads/main",
    after: "abc1234",
    repository: { id: 1, full_name: "acme/repo", name: "repo" },
    ...commits,
  };
}

describe("changedPathsFromPush", () => {
  it("unions added/removed/modified across commits and head_commit, deduped", () => {
    const ev = push({
      commits: [
        { id: "c1", message: "m", added: ["a.ts"], modified: ["shared.ts"] },
        { id: "c2", message: "m", removed: ["b.ts"], modified: ["shared.ts"] },
      ],
      head_commit: { id: "c2", message: "m", added: ["c.ts"] },
    });
    expect(changedPathsFromPush(ev).sort()).toEqual([
      "a.ts",
      "b.ts",
      "c.ts",
      "shared.ts",
    ]);
  });

  it("returns empty when GitHub omits the file lists", () => {
    expect(changedPathsFromPush(push({ head_commit: { id: "c", message: "m" } }))).toEqual([]);
    expect(changedPathsFromPush(push({}))).toEqual([]);
  });
});

describe("matchesWatchPatterns", () => {
  it("rebuilds when no patterns are configured", () => {
    expect(matchesWatchPatterns(["anything.ts"], undefined)).toBe(true);
    expect(matchesWatchPatterns(["anything.ts"], null)).toBe(true);
    expect(matchesWatchPatterns(["anything.ts"], [])).toBe(true);
  });

  it("fails open when the change set is unknown", () => {
    expect(matchesWatchPatterns([], ["apps/api/**"])).toBe(true);
  });

  it("fails open when every pattern is blank", () => {
    expect(matchesWatchPatterns(["apps/web/x.ts"], ["  ", ""])).toBe(true);
  });

  it("rebuilds when a changed path matches a glob", () => {
    expect(matchesWatchPatterns(["apps/api/src/index.ts"], ["apps/api/**"])).toBe(true);
    expect(matchesWatchPatterns(["packages/db/schema.ts"], ["**/*.ts"])).toBe(true);
    expect(matchesWatchPatterns(["package.json"], ["package.json"])).toBe(true);
  });

  it("skips when no changed path matches any glob", () => {
    expect(matchesWatchPatterns(["apps/web/x.ts"], ["apps/api/**"])).toBe(false);
    expect(
      matchesWatchPatterns(["docs/readme.md", "apps/web/x.ts"], ["apps/api/**", "packages/**"]),
    ).toBe(false);
  });

  it("matches when any one of several patterns hits", () => {
    expect(
      matchesWatchPatterns(["packages/shared/util.ts"], ["apps/api/**", "packages/shared/**"]),
    ).toBe(true);
  });
});
