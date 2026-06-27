import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pruneStaleBuildCache } from "../build-workdir";

const tmpDirs: string[] = [];

function tempCacheDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "otter-cache-test-"));
  tmpDirs.push(dir);
  return dir;
}

/** Backdate a path's mtime by `days`. */
function age(path: string, days: number): void {
  const t = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  utimesSync(path, t, t);
}

afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("pruneStaleBuildCache", () => {
  test("removes cache dirs older than the 14d TTL, keeps fresh ones", async () => {
    const cacheDir = tempCacheDir();
    const stale = join(cacheDir, "ghcr.io_acme_old");
    const fresh = join(cacheDir, "ghcr.io_acme_new");
    mkdirSync(stale);
    mkdirSync(fresh);
    age(stale, 30); // well past the 14d TTL
    // fresh keeps its just-now mtime

    await pruneStaleBuildCache(Date.now(), cacheDir);

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  test("no-op when the cache dir doesn't exist", async () => {
    const missing = join(tmpdir(), "otter-cache-absent-xyz");
    rmSync(missing, { recursive: true, force: true });
    // Must not throw.
    await pruneStaleBuildCache(Date.now(), missing);
    expect(existsSync(missing)).toBe(false);
  });
});
