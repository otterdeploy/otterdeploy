/**
 * Argv assembly for the two railpack invocations: `railpack prepare` (which
 * analyses the source and writes the BuildKit plan) and the `docker buildx
 * build` that executes that plan. Split out of railpack.ts so that file stays
 * within the size budget; both functions are PURE, which is what makes them
 * testable without invoking either tool.
 */

import { readFileSync } from "node:fs";

import type { LogSink } from "./log-stream";
import type { BuildLayout } from "./railpack-layout";

import { builderFlags, cacheFlags, noCacheFlags } from "./buildx";

/** Cap V8's old-space heap for the JS build step so a heavy build
 *  (vite/webpack/next) GCs under pressure instead of ballooning and letting the
 *  host OOM-killer take down buildkitd (observed: a `vite build` OOM-killed the
 *  cache builder mid-run). Sized to ~60% of host RAM (from /proc/meminfo),
 *  clamped to a sane band; a conservative default when host RAM is unknown. */
export function nodeBuildMaxOldSpaceMb(): number {
  try {
    const kb = Number(/^MemTotal:\s+(\d+) kB/m.exec(readFileSync("/proc/meminfo", "utf8"))?.[1]);
    const totalMb = Math.floor(kb / 1024);
    if (totalMb > 0) return Math.max(1024, Math.min(Math.floor(totalMb * 0.6), 6144));
  } catch {
    // /proc unavailable (non-Linux, restricted): fall through to the default.
  }
  return 2048;
}

/** Frontend image that executes the BuildKit plan. Pinned to an explicit tag
 *  (NOT `latest`) and kept in lockstep with the railpack CLI version installed
 *  in the Dockerfile (ARG RAILPACK_VERSION): the plan format and the frontend
 *  that runs it must agree, or BuildKit fails with cryptic errors like
 *  "secret RAILPACK_SPA_OUTPUT_DIR: not found". Bump both together. */
const RAILPACK_FRONTEND = "ghcr.io/railwayapp/railpack-frontend:v0.35.0";

/**
 * Assemble the `railpack prepare` args. `--error-missing-start` fails the build
 * LOUDLY at analysis time when railpack can't find a way to start the app,
 * instead of emitting a runnable-less image that builds fine but exits on boot
 * (surfacing only as an opaque "swarm convergence failed" much later, railpack
 * instead prints an actionable message: add a `start` script, a `main` field, or
 * set RAILPACK_SPA_OUTPUT_DIR for a static site). A static SPA rides on the
 * `--env RAILPACK_SPA_OUTPUT_DIR` flag, which railpack reads at prepare time.
 */

export function buildPrepareArgs(opts: {
  layout: BuildLayout;
  buildCmd: string | null;
  startCmd: string | null;
  /** Extra vars to DECLARE to railpack. `prepare --env K=V` records only the
   *  key in the plan's `secrets` list; the value is supplied at build time via
   *  `--secret id=K,env=K`, so secrets never touch the on-disk plan. */
  extraEnv?: Record<string, string>;
  sink: LogSink;
}): string[] {
  const { buildDir, planPath, infoPath, spaOutputDir } = opts.layout;
  const args = [
    "prepare",
    buildDir,
    "--plan-out",
    planPath,
    "--info-out",
    infoPath,
    "--error-missing-start",
  ];
  if (opts.buildCmd) args.push("--build-cmd", opts.buildCmd);
  if (opts.startCmd) args.push("--start-cmd", opts.startCmd);
  if (spaOutputDir) {
    args.push("--env", `RAILPACK_SPA_OUTPUT_DIR=${spaOutputDir}`);
    opts.sink.system(`SPA mode: serving "${spaOutputDir}" via Caddy with history fallback`);
  }
  const maxOldSpaceMb = nodeBuildMaxOldSpaceMb();
  args.push("--env", `NODE_OPTIONS=--max-old-space-size=${maxOldSpaceMb}`);
  opts.sink.system(`build memory guard: NODE_OPTIONS max-old-space-size=${maxOldSpaceMb}MB`);
  for (const [key, value] of Object.entries(opts.extraEnv ?? {})) {
    args.push("--env", `${key}=${value}`);
  }
  return args;
}

/**
 * Assemble the `docker buildx build` args: execute the railpack plan through the
 * pinned BuildKit frontend, `--load` the result into the local daemon, and tag
 * both `:<sha>` and `:latest`. A static SPA additionally forwards the output dir
 * as a build secret so the plan can resolve `RAILPACK_SPA_OUTPUT_DIR`.
 */
export function buildBuildxArgs(opts: {
  planPath: string;
  shaTag: string;
  latestTag: string;
  buildDir: string;
  spaOutputDir: string | null;
  builderName?: string | null;
  cachePath?: string | null;
  noCache?: boolean | null;
  /** Additional `--secret` flags (turbo credentials, TURBO_FORCE). */
  extraSecretFlags?: string[];
}): string[] {
  return [
    "buildx",
    "build",
    ...builderFlags(opts.builderName),
    ...noCacheFlags(opts.noCache),
    "--build-arg",
    `BUILDKIT_SYNTAX=${RAILPACK_FRONTEND}`,
    ...(opts.extraSecretFlags ?? []),
    ...(opts.spaOutputDir
      ? ["--secret", "id=RAILPACK_SPA_OUTPUT_DIR,env=RAILPACK_SPA_OUTPUT_DIR"]
      : []),
    // prepare always injects NODE_OPTIONS (the build memory guard), which the
    // generated plan consumes as a build secret. Same mechanism as the SPA
    // output dir. Without this flag every railpack build fails with
    // "failed to solve: secret NODE_OPTIONS: not found".
    "--secret",
    "id=NODE_OPTIONS,env=NODE_OPTIONS",
    "-f",
    opts.planPath,
    "--load",
    "-t",
    opts.shaTag,
    "-t",
    opts.latestTag,
    ...cacheFlags(opts.builderName, opts.cachePath, Boolean(opts.noCache)),
    opts.buildDir,
  ];
}
