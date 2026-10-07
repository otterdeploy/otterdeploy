/**
 * The bun floor in railpack-packagemanager.ts: a repo pinning a bun below
 * MIN_BUN_VERSION (1.3.13) is bumped to it, everything else is left alone.
 * The comparison is Bun.semver on the CORE version, so a `+hash` or a
 * `-canary` suffix does not change the verdict for the release it decorates.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LogSink } from "../log-stream";

import { applyPackageManager } from "../railpack-packagemanager";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createSink(lines: string[]): LogSink {
  return {
    write: () => undefined,
    system: (line) => void lines.push(line),
    setPhase: () => undefined,
    close: async () => undefined,
  };
}

/** Run the rewrite on a package.json pinning `packageManager`; return the
 *  field afterwards and what the build log was told. */
async function pinned(
  packageManager: string | undefined,
  override: string | null = null,
): Promise<{ field: unknown; log: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), "railpack-pm-"));
  dirs.push(dir);
  const path = join(dir, "package.json");
  writeFileSync(path, JSON.stringify({ name: "app", packageManager, scripts: { start: "x" } }));
  const log: string[] = [];
  await applyPackageManager(dir, override, createSink(log));
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const field =
    typeof parsed === "object" && parsed !== null && "packageManager" in parsed
      ? parsed.packageManager
      : undefined;
  return { field, log };
}

describe("bun floor", () => {
  test.each([
    ["bun@1.3.1", "bun@1.3.13"],
    ["bun@1.3.9", "bun@1.3.13"],
    ["bun@1.3.10", "bun@1.3.13"],
    ["bun@1.3.12", "bun@1.3.13"],
    // A build hash or prerelease below the floor: still below it.
    ["bun@1.3.10+abc123", "bun@1.3.13"],
    ["bun@1.3.10-canary.4", "bun@1.3.13"],
    // Not a full version: cannot be shown to be at the floor, so bumped.
    ["bun@1.3", "bun@1.3.13"],
    ["bun@latest", "bun@1.3.13"],
  ])("%s is bumped to %s", async (from, to) => {
    const { field, log } = await pinned(from);
    expect(field).toBe(to);
    expect(log.join("\n")).toContain("below the supported floor");
  });

  test.each([
    "bun@1.3.13",
    "bun@1.3.14",
    "bun@1.4.2",
    "bun@1.10.0",
    "bun@2.0.0",
    // The suffix decorates a release at/above the floor: built as pinned.
    "bun@1.3.13+abc123",
    "bun@1.3.13-canary.2",
  ])("%s is left as pinned", async (from) => {
    const { field, log } = await pinned(from);
    expect(field).toBe(from);
    expect(log).toEqual([]);
  });

  test("other package managers and an unset field are never touched", async () => {
    expect((await pinned("pnpm@9.12.0")).field).toBe("pnpm@9.12.0");
    expect((await pinned("npm@1.0.0")).field).toBe("npm@1.0.0");
    expect((await pinned(undefined)).field).toBeUndefined();
  });

  test("an explicit override wins over the floor", async () => {
    const { field } = await pinned("bun@1.3.1", "bun@1.3.2");
    expect(field).toBe("bun@1.3.2");
  });
});
