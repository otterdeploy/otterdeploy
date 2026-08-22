import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LogSink } from "../log-stream";

import { cacheFlags, noCacheFlags, turboForceEnv } from "../buildx";
import { TURBO_CACHE_DIR, injectTurboCache } from "../railpack-plan";

const tmpDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "otter-cache-test-"));
  tmpDirs.push(dir);
  return dir;
}

function fakeSink(): LogSink & { lines: string[] } {
  const lines: string[] = [];
  const sink = {
    lines,
    system: (m: string) => void lines.push(m),
    stdout: () => undefined,
    stderr: () => undefined,
    setPhase: () => undefined,
    close: () => Promise.resolve(),
  };
  // oxlint-disable-next-line typescript/consistent-type-assertions
  return sink as unknown as LogSink & { lines: string[] };
}

afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("cacheFlags", () => {
  test("imports and exports when a cache builder is available", () => {
    expect(cacheFlags("otterdeploy-cache", "/cache/x")).toEqual([
      "--cache-from",
      "type=local,src=/cache/x",
      "--cache-to",
      "type=local,dest=/cache/x,mode=max",
    ]);
  });

  test("a bypass stops READING the cache but keeps repopulating it", () => {
    const flags = cacheFlags("otterdeploy-cache", "/cache/x", true);
    expect(flags).toEqual(["--cache-to", "type=local,dest=/cache/x,mode=max"]);
    expect(flags).not.toContain("--cache-from");
  });

  test("emits nothing without both a builder and a path", () => {
    expect(cacheFlags(null, "/cache/x")).toEqual([]);
    expect(cacheFlags("otterdeploy-cache", null)).toEqual([]);
    expect(cacheFlags(null, null, true)).toEqual([]);
  });
});

describe("noCacheFlags / turboForceEnv", () => {
  test("the bypass reaches BuildKit and turbo alike", () => {
    expect(noCacheFlags(true)).toEqual(["--no-cache"]);
    expect(turboForceEnv(true)).toEqual({ TURBO_FORCE: "1" });
  });

  test("a normal build sets neither", () => {
    expect(noCacheFlags(false)).toEqual([]);
    expect(noCacheFlags(null)).toEqual([]);
    expect(turboForceEnv(undefined)).toEqual({});
  });
});

describe("injectTurboCache", () => {
  function plan(dir: string, value: unknown): string {
    const path = join(dir, "railpack-plan.json");
    writeFileSync(path, JSON.stringify(value));
    return path;
  }

  test("registers the cache and attaches it to the build step", async () => {
    const dir = tempDir();
    const path = plan(dir, {
      caches: { "npm-install": { directory: "/root/.npm", type: "shared" } },
      steps: [
        { name: "install", caches: ["npm-install"], commands: [] },
        { name: "build", caches: ["node-modules"], commands: [] },
      ],
      secrets: ["NODE_OPTIONS"],
    });

    await injectTurboCache(path, fakeSink());
    const updated = JSON.parse(readFileSync(path, "utf8"));

    expect(updated.caches["otterdeploy-turbo"]).toEqual({
      directory: TURBO_CACHE_DIR,
      type: "shared",
    });
    expect(updated.steps[1].caches).toEqual(["node-modules", "otterdeploy-turbo"]);
    // Untouched: the other step, the pre-existing caches, and unknown keys.
    expect(updated.steps[0].caches).toEqual(["npm-install"]);
    expect(updated.caches["npm-install"]).toEqual({ directory: "/root/.npm", type: "shared" });
    expect(updated.secrets).toEqual(["NODE_OPTIONS"]);
  });

  test("a build step with no caches array still gets one", async () => {
    const dir = tempDir();
    const path = plan(dir, { steps: [{ name: "build", commands: [] }] });
    await injectTurboCache(path, fakeSink());
    expect(JSON.parse(readFileSync(path, "utf8")).steps[0].caches).toEqual(["otterdeploy-turbo"]);
  });

  test("is idempotent across repeated runs", async () => {
    const dir = tempDir();
    const path = plan(dir, { steps: [{ name: "build", caches: [] }] });
    await injectTurboCache(path, fakeSink());
    await injectTurboCache(path, fakeSink());
    expect(JSON.parse(readFileSync(path, "utf8")).steps[0].caches).toEqual(["otterdeploy-turbo"]);
  });

  test("a plan with no build step is left alone, with a reason", async () => {
    const dir = tempDir();
    const original = { steps: [{ name: "install", caches: [] }] };
    const path = plan(dir, original);
    const sink = fakeSink();
    await injectTurboCache(path, sink);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(original);
    expect(sink.lines.join("\n")).toContain("no build step");
  });

  test("an unreadable or malformed plan never throws", async () => {
    const dir = tempDir();
    await injectTurboCache(join(dir, "missing.json"), fakeSink());

    const broken = join(dir, "broken.json");
    writeFileSync(broken, "{ not json");
    await injectTurboCache(broken, fakeSink());
    expect(readFileSync(broken, "utf8")).toBe("{ not json");
  });
});
