import { describe, it, expect } from "vitest";
import { matchesWatchPaths } from "../watch-paths";

describe("matchesWatchPaths", () => {
  it("returns true when watchPaths is null (always matches)", () => {
    const result = matchesWatchPaths(
      ["src/index.ts", "README.md"],
      null,
    );

    expect(result).toBe(true);
  });

  it("returns true when watchPaths is empty (always matches)", () => {
    const result = matchesWatchPaths(
      ["src/index.ts"],
      [],
    );

    expect(result).toBe(true);
  });

  it("matches files under a glob pattern with **", () => {
    const result = matchesWatchPaths(
      ["apps/api/src/index.ts"],
      ["apps/api/**"],
    );

    expect(result).toBe(true);
  });

  it("does NOT match files outside the glob pattern", () => {
    const result = matchesWatchPaths(
      ["apps/web/src/index.ts"],
      ["apps/api/**"],
    );

    expect(result).toBe(false);
  });

  it("matches when any pattern matches (multiple patterns)", () => {
    const result = matchesWatchPaths(
      ["packages/db/schema.ts"],
      ["apps/api/**", "packages/db/**"],
    );

    expect(result).toBe(true);
  });

  it("handles single wildcard * correctly", () => {
    const result = matchesWatchPaths(
      ["src/index.ts"],
      ["src/*.ts"],
    );

    expect(result).toBe(true);
  });

  it("single wildcard * does not match across path separators", () => {
    const result = matchesWatchPaths(
      ["src/deep/index.ts"],
      ["src/*.ts"],
    );

    expect(result).toBe(false);
  });

  it("returns false when no files match any pattern", () => {
    const result = matchesWatchPaths(
      ["docs/README.md", "LICENSE"],
      ["src/**", "apps/**"],
    );

    expect(result).toBe(false);
  });
});
