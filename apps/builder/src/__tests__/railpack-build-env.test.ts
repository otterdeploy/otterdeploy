/**
 * A service's own variables must reach a Railpack BUILD, not just
 * the running container.
 *
 * Frameworks inline env at build time (Next `NEXT_PUBLIC_*`, Vite `VITE_*`,
 * Nuxt, Astro), and Railpack reads its own `RAILPACK_*` overrides at `prepare`
 * time, so the service's own variables must reach the build, not only the
 * builder's cache/memory knobs; otherwise a prerendered Next page ships
 * without the var it was configured with.
 *
 * The real `railpackBuild` runs here against fake `railpack` and `docker`
 * executables placed first on PATH. Each records its argv and environment, and
 * the fake docker also reads every `--secret id=K,src=FILE` while it runs (the
 * files are deleted once the build ends), so the test sees exactly what the two
 * child processes would have received, with no module mocking.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LogSink } from "../log-stream";

import { railpackBuild } from "../railpack";
import { NO_SERVICE_BUILD_ENV, type ServiceBuildEnv, railpackBuildEnv } from "../railpack-env";

const MARKER = "otterfix:build-env-next-public:be268d";

const tmpDirs: string[] = [];
// eslint-disable-next-line node/no-process-env
const originalPath = process.env.PATH;

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

interface RecordedCall {
  argv: string[];
  env: Map<string, string>;
  /** docker only: secret id → contents of its `src=` file at build time. */
  secretFiles: Map<string, string>;
}

/** NUL-separated `K=V` records into a map. */
function readPairs(path: string): Map<string, string> {
  const pairs = new Map<string, string>();
  if (!existsSync(path)) return pairs;
  for (const entry of readFileSync(path, "utf8").split("\0")) {
    const eq = entry.indexOf("=");
    if (eq > 0) pairs.set(entry.slice(0, eq), entry.slice(eq + 1));
  }
  return pairs;
}

/** Install fake `railpack` + `docker` that dump argv, env and secret files. */
function installFakeTools(): { calls: (tool: "railpack" | "docker") => RecordedCall } {
  const binDir = tempDir("otter-fake-bin-");
  const outDir = tempDir("otter-fake-out-");
  const out = (tool: string, what: string) => join(outDir, `${tool}.${what}`);
  for (const tool of ["railpack", "docker"] as const) {
    const script = join(binDir, tool);
    writeFileSync(
      script,
      [
        "#!/bin/sh",
        `printf '%s\\0' "$@" > "${out(tool, "argv")}"`,
        `env -0 > "${out(tool, "env")}"`,
        `: > "${out(tool, "secrets")}"`,
        'for a in "$@"; do',
        '  case "$a" in',
        "    id=*,src=*)",
        '      id="${a#id=}"; id="${id%%,src=*}"; src="${a#*,src=}"',
        `      printf '%s=%s\\0' "$id" "$(cat "$src")" >> "${out(tool, "secrets")}"`,
        "      ;;",
        "  esac",
        "done",
        // A build that echoes its env, the way a careless build script would.
        'echo "seen DATABASE_URL=$DATABASE_URL"',
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(script, 0o755);
  }
  // eslint-disable-next-line node/no-process-env
  process.env.PATH = `${binDir}:${originalPath ?? ""}`;
  return {
    calls: (tool) => ({
      argv: readFileSync(out(tool, "argv"), "utf8").split("\0").slice(0, -1),
      env: readPairs(out(tool, "env")),
      secretFiles: readPairs(out(tool, "secrets")),
    }),
  };
}

function fakeSink(): { sink: LogSink; lines: string[] } {
  const lines: string[] = [];
  const sink: LogSink = {
    write: (_stream, line) => void lines.push(line),
    system: (line) => void lines.push(line),
    setPhase: () => undefined,
    close: () => Promise.resolve(),
  };
  return { sink, lines };
}

/** A single-app Next.js repo that inlines a `NEXT_PUBLIC_*` var at build time. */
function nextApp(): string {
  const workDir = tempDir("otter-build-env-");
  writeFileSync(
    join(workDir, "package.json"),
    JSON.stringify({
      name: "build-env-next-public",
      scripts: { build: "next build", start: "next start" },
      dependencies: { next: "16.4.0" },
    }),
  );
  mkdirSync(join(workDir, "app"));
  return workDir;
}

async function build(serviceEnv: ServiceBuildEnv, extra: { spa?: boolean } = {}) {
  const tools = installFakeTools();
  const { sink, lines } = fakeSink();
  await railpackBuild({
    workDir: nextApp(),
    sourceSubdir: null,
    imageRepository: "registry.local/acme/web",
    sha: "abc123",
    config: extra.spa ? { builder: "railpack", spa: true } : null,
    serviceEnv,
    sink,
  });
  return { prepare: tools.calls("railpack"), buildx: tools.calls("docker"), lines };
}

function plain(env: Record<string, string>): ServiceBuildEnv {
  return { env, secretValues: [] };
}

/** The value following each `flag` occurrence in argv. */
function flagValues(argv: string[], flag: string): string[] {
  return argv.flatMap((arg, i) => (arg === flag && argv[i + 1] ? [argv[i + 1] ?? ""] : []));
}

/** The secret file path buildx was given for `id`, if any. */
function secretSrc(argv: string[], id: string): string | undefined {
  return flagValues(argv, "--secret")
    .find((s) => s.startsWith(`id=${id},src=`))
    ?.slice(`id=${id},src=`.length);
}

afterEach(() => {
  // eslint-disable-next-line node/no-process-env
  process.env.PATH = originalPath;
  while (tmpDirs.length) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("railpackBuild: service env reaches the build", () => {
  test("a NEXT_PUBLIC_* var is declared to prepare and mounted into the buildx build", async () => {
    const { prepare, buildx } = await build(plain({ NEXT_PUBLIC_OTTERFIX_MARKER: MARKER }));

    // prepare: declared by NAME only, value supplied through the process env
    // (railpack's `--env NAME` reads os env), so the plan records the key only.
    expect(flagValues(prepare.argv, "--env")).toContain("NEXT_PUBLIC_OTTERFIX_MARKER");
    expect(prepare.env.get("NEXT_PUBLIC_OTTERFIX_MARKER")).toBe(MARKER);

    // buildx: mounted as a BuildKit secret from a file holding the value.
    expect(buildx.secretFiles.get("NEXT_PUBLIC_OTTERFIX_MARKER")).toBe(MARKER);

    // The value never rides argv: not into the plan, not into a logged command line.
    expect(prepare.argv.join(" ")).not.toContain(MARKER);
    expect(buildx.argv.join(" ")).not.toContain(MARKER);
  });

  test("service values never enter the docker CLI's own environment", async () => {
    const { buildx } = await build(
      plain({ DOCKER_CONFIG: "/tmp/evil", DOCKER_HOST: "tcp://evil:2375", NEXT_PUBLIC_A: "1" }),
    );
    // The build still sees them (as secret files)...
    expect(buildx.secretFiles.get("DOCKER_HOST")).toBe("tcp://evil:2375");
    // ...but the CLI driving the host socket is not configured by them.
    expect(buildx.env.get("DOCKER_HOST")).not.toBe("tcp://evil:2375");
    expect(buildx.env.get("DOCKER_CONFIG")).not.toBe("/tmp/evil");
    expect(buildx.env.get("NEXT_PUBLIC_A")).toBeUndefined();
  });

  test("the secret files are gone once the build ends", async () => {
    const { buildx } = await build(plain({ NEXT_PUBLIC_A: "1" }));
    const src = secretSrc(buildx.argv, "NEXT_PUBLIC_A");
    expect(src).toBeDefined();
    expect(existsSync(src ?? "")).toBe(false);
  });

  test("a RAILPACK_* override set as service env takes effect at prepare", async () => {
    const { prepare } = await build(plain({ RAILPACK_BUILD_CMD: "npm run build:prod" }));
    expect(flagValues(prepare.argv, "--env")).toContain("RAILPACK_BUILD_CMD");
    expect(prepare.env.get("RAILPACK_BUILD_CMD")).toBe("npm run build:prod");
  });

  test("a changed value invalidates the layer cache via secrets-hash", async () => {
    const first = await build(plain({ NEXT_PUBLIC_A: "one" }));
    const again = await build(plain({ NEXT_PUBLIC_A: "one" }));
    const changed = await build(plain({ NEXT_PUBLIC_A: "two" }));

    const hash = (argv: string[]) =>
      flagValues(argv, "--build-arg").find((a) => a.startsWith("secrets-hash="));
    expect(hash(first.buildx.argv)).toMatch(/^secrets-hash=[0-9a-f]{64}$/);
    expect(hash(again.buildx.argv)).toBe(hash(first.buildx.argv));
    expect(hash(changed.buildx.argv)).not.toBe(hash(first.buildx.argv));
  });

  test("a service with no variables builds exactly as before", async () => {
    const { buildx } = await build(NO_SERVICE_BUILD_ENV);
    expect(flagValues(buildx.argv, "--build-arg").some((a) => a.startsWith("secrets-hash="))).toBe(
      false,
    );
    expect(flagValues(buildx.argv, "--secret")).toEqual(["id=NODE_OPTIONS,env=NODE_OPTIONS"]);
  });

  test("builder-owned keys win over the service's, and the override is logged", async () => {
    const { prepare, buildx, lines } = await build(
      plain({ NODE_OPTIONS: "--max-old-space-size=99999", RAILPACK_SPA_OUTPUT_DIR: "out" }),
      { spa: true },
    );
    expect(prepare.env.get("NODE_OPTIONS")).not.toBe("--max-old-space-size=99999");
    expect(buildx.env.get("RAILPACK_SPA_OUTPUT_DIR")).toBe("dist");
    expect(buildx.secretFiles.size).toBe(0);
    expect(lines.some((l) => l.includes("NODE_OPTIONS") && l.includes("builder"))).toBe(true);
  });

  test("sealed/secret values are masked in the build log", async () => {
    const { lines } = await build({
      env: { DATABASE_URL: "postgres://u:hunter2-sealed@db/x" },
      secretValues: ["postgres://u:hunter2-sealed@db/x"],
    });
    expect(lines.join("\n")).not.toContain("hunter2-sealed");
    expect(lines).toContain("seen DATABASE_URL=***");
  });
});

describe("railpackBuildEnv", () => {
  test("turbo credentials stay governed by the remote-cache setting", () => {
    const built = railpackBuildEnv({
      serviceEnv: { TURBO_TOKEN: "tok", NEXT_PUBLIC_X: "1" },
      builderEnv: {},
    });
    expect(built.serviceEnv).toEqual({ NEXT_PUBLIC_X: "1" });
    expect(built.dropped.map((d) => d.key)).toEqual(["TURBO_TOKEN"]);
  });

  test("names that would steer the builder's own process are held back", () => {
    const built = railpackBuildEnv({
      serviceEnv: { PATH: "/evil", LD_PRELOAD: "/x.so", HOME: "/h", GOOD: "1" },
      builderEnv: {},
    });
    expect(built.serviceEnv).toEqual({ GOOD: "1" });
    expect(built.dropped.map((d) => d.key).sort()).toEqual(["HOME", "LD_PRELOAD", "PATH"]);
  });

  test("a key that is not an env name is dropped, not passed to buildx", () => {
    const built = railpackBuildEnv({
      serviceEnv: { "bad,key": "x", "with=eq": "y", GOOD_1: "z" },
      builderEnv: {},
    });
    expect(Object.keys(built.serviceEnv)).toEqual(["GOOD_1"]);
    expect(built.dropped.map((d) => d.key).sort()).toEqual(["bad,key", "with=eq"]);
  });

  test("the hash covers the service's values only, in a stable order", () => {
    const a = railpackBuildEnv({
      serviceEnv: { A: "1", B: "2" },
      builderEnv: { NODE_OPTIONS: "x" },
    });
    const b = railpackBuildEnv({
      serviceEnv: { B: "2", A: "1" },
      builderEnv: { NODE_OPTIONS: "y" },
    });
    expect(a.secretsHash).toBe(b.secretsHash);
    expect(railpackBuildEnv({ serviceEnv: {}, builderEnv: { X: "1" } }).secretsHash).toBeNull();
  });
});
