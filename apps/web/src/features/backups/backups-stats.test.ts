/**
 * The Activity summary is one line of facts, not four tiles.
 */
import { describe, expect, it } from "vite-plus/test";

import { summaryParts } from "./backups-stats";

/** A run that settled a minute ago (the summary reads only its times). */
function backup() {
  return { createdAt: new Date(Date.now() - 120_000), completedAt: new Date(Date.now() - 60_000) };
}

describe("summaryParts", () => {
  it("reads one backup, its size, and no failures", () => {
    const parts = summaryParts({
      total: 1,
      matchCount: 1,
      storedBytes: 1024,
      lastSuccess: backup(),
      lastFail: undefined,
    }).map((p) => p.text);
    expect(parts[0]).toBe("1 backup");
    expect(parts[1]).toMatch(/stored$/);
    expect(parts[2]).toMatch(/^last success /);
    expect(parts[3]).toBe("no failures");
  });

  it("names a failure in words, flagged for the warning tone", () => {
    const parts = summaryParts({
      total: 3,
      matchCount: 2,
      storedBytes: 0,
      lastSuccess: undefined,
      lastFail: backup(),
    });
    expect(parts.map((p) => p.text)).toContain("2 shown");
    expect(parts.map((p) => p.text)).toContain("no successful backup yet");
    const failure = parts.at(-1);
    expect(failure?.text).toMatch(/^last failure /);
    expect(failure?.warn).toBe(true);
  });
});
