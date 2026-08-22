import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { LogSink } from "../log-stream";

import {
  assertTurboRanTasks,
  detectTurbo,
  resolveTurboFilter,
  resolveWorkspaceRunner,
  workspaceBuildCommand,
} from "../turbo-runner";

const tmpDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "otter-turbo-test-"));
  tmpDirs.push(dir);
  return dir;
}

function writeJson(dir: string, rel: string, value: unknown): void {
  const path = join(dir, rel);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

/** Minimal LogSink capturing the system() lines the runner emits. */
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
  // The runner only ever calls `system`; the rest satisfy the interface.
  // oxlint-disable-next-line typescript/consistent-type-assertions
  return sink as unknown as LogSink & { lines: string[] };
}

/** A workspace root with turbo installed and one app. */
function turborepo(opts: { turboDep?: boolean; turboJson?: boolean; unnamedApp?: boolean } = {}) {
  const workDir = tempDir();
  writeJson(workDir, "package.json", {
    workspaces: ["apps/*"],
    packageManager: "bun@1.3.13",
    ...(opts.turboDep === false ? {} : { devDependencies: { turbo: "^2.0.0" } }),
  });
  if (opts.turboJson !== false) writeJson(workDir, "turbo.json", { tasks: {} });
  writeJson(workDir, "apps/web/package.json", {
    ...(opts.unnamedApp ? {} : { name: "@acme/web" }),
    scripts: { build: "vite build", start: "node server.js" },
  });
  return workDir;
}

afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("detectTurbo", () => {
  test("usable when both turbo.json and the turbo dependency are present", async () => {
    expect(await detectTurbo(turborepo())).toEqual({ usable: true, reason: null });
  });

  test("turbo.json without the dependency is rejected with a reason", async () => {
    const res = await detectTurbo(turborepo({ turboDep: false }));
    expect(res.usable).toBe(false);
    expect(res.reason).toContain("no turbo dependency");
  });

  test("the dependency without turbo.json is rejected with a reason", async () => {
    const res = await detectTurbo(turborepo({ turboJson: false }));
    expect(res.usable).toBe(false);
    expect(res.reason).toContain("no turbo.json");
  });

  test("neither present is a silent absence, not a complaint", async () => {
    const dir = tempDir();
    writeJson(dir, "package.json", { workspaces: ["apps/*"] });
    expect(await detectTurbo(dir)).toEqual({ usable: false, reason: null });
  });
});

describe("resolveTurboFilter", () => {
  test("uses the app's package NAME, not its directory", async () => {
    expect(await resolveTurboFilter(turborepo(), "apps/web")).toBe("@acme/web");
  });

  test("falls back to turbo's ./path filter when the package has no name", async () => {
    expect(await resolveTurboFilter(turborepo({ unnamedApp: true }), "apps/web")).toBe(
      "./apps/web",
    );
  });
});

describe("resolveWorkspaceRunner", () => {
  test("auto picks turbo in a turborepo", async () => {
    const sink = fakeSink();
    const runner = await resolveWorkspaceRunner({
      workDir: turborepo(),
      subdir: "apps/web",
      configured: "auto",
      configuredFilter: null,
      sink,
    });
    expect(runner).toEqual({ kind: "turbo", filter: "@acme/web", pmRun: "bun run" });
    expect(sink.lines.join("\n")).toContain("--filter=@acme/web");
  });

  test("auto degrades to the package script when turbo is absent", async () => {
    const dir = tempDir();
    writeJson(dir, "package.json", { workspaces: ["apps/*"], packageManager: "pnpm@9.12.0" });
    writeJson(dir, "apps/web/package.json", { name: "w", scripts: { build: "x" } });
    const runner = await resolveWorkspaceRunner({
      workDir: dir,
      subdir: "apps/web",
      configured: "auto",
      configuredFilter: null,
      sink: fakeSink(),
    });
    expect(runner).toEqual({ kind: "script", pmRun: "pnpm run" });
  });

  test("script mode ignores turbo entirely", async () => {
    const runner = await resolveWorkspaceRunner({
      workDir: turborepo(),
      subdir: "apps/web",
      configured: "script",
      configuredFilter: null,
      sink: fakeSink(),
    });
    expect(runner.kind).toBe("script");
  });

  test("an explicit filter overrides the derived package name", async () => {
    const runner = await resolveWorkspaceRunner({
      workDir: turborepo(),
      subdir: "apps/web",
      configured: "turbo",
      configuredFilter: "  @acme/other  ",
      sink: fakeSink(),
    });
    expect(runner).toMatchObject({ kind: "turbo", filter: "@acme/other" });
  });

  test("pinning turbo where it is unusable fails loudly rather than degrading", async () => {
    await expect(
      resolveWorkspaceRunner({
        workDir: turborepo({ turboDep: false }),
        subdir: "apps/web",
        configured: "turbo",
        configuredFilter: null,
        sink: fakeSink(),
      }),
    ).rejects.toThrow(/pinned to Turborepo/);
  });
});

describe("workspaceBuildCommand", () => {
  const turbo = { kind: "turbo", filter: "@acme/web", pmRun: "bun run" } as const;
  const script = { kind: "script", pmRun: "bun run" } as const;

  test("turbo runs from the repo root so dependencies build first", () => {
    expect(workspaceBuildCommand({ runner: turbo, subdir: "apps/web", hasBuildScript: true })).toBe(
      "bun run turbo run build --filter=@acme/web",
    );
  });

  test("the script runner keeps the cd-into-the-app shape", () => {
    expect(
      workspaceBuildCommand({ runner: script, subdir: "apps/web", hasBuildScript: true }),
    ).toBe("cd apps/web && bun run build");
  });

  test("no build script means no build command", () => {
    expect(
      workspaceBuildCommand({ runner: turbo, subdir: "apps/web", hasBuildScript: false }),
    ).toBeNull();
  });
});

describe("assertTurboRanTasks", () => {
  const turbo = { kind: "turbo", filter: "@acme/web", pmRun: "bun run" } as const;

  test("throws when turbo matched nothing, so no empty image ships", () => {
    expect(() =>
      assertTurboRanTasks({
        runner: turbo,
        buildLog: "• No tasks were executed as part of this run.",
      }),
    ).toThrow(/matched no tasks/);
  });

  test("stays quiet on a normal build log", () => {
    expect(() =>
      assertTurboRanTasks({ runner: turbo, buildLog: "Tasks: 3 successful, 3 total" }),
    ).not.toThrow();
  });

  test("never fires for the script runner", () => {
    expect(() =>
      assertTurboRanTasks({
        runner: { kind: "script", pmRun: "bun run" },
        buildLog: "No tasks were executed",
      }),
    ).not.toThrow();
  });
});
