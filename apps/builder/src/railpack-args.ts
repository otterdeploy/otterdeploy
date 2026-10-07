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
 * set RAILPACK_SPA_OUTPUT_DIR for a static site).
 *
 * Every build variable (the SPA output dir, the NODE_OPTIONS memory guard, the
 * service's own env) is declared by NAME only: `--env NAME` makes railpack read
 * the value from its process env and record just the name in the plan's
 * `secrets`. See railpack-env.ts for why the value must stay out of argv.
 */
export function buildPrepareArgs(opts: {
  layout: BuildLayout;
  buildCmd: string | null;
  startCmd: string | null;
  /** Names of the variables in the build env (railpack-env.ts). Their values
   *  must be in the `railpack prepare` process env. */
  envNames: string[];
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
    opts.sink.system(`SPA mode: serving "${spaOutputDir}" via Caddy with history fallback`);
  }
  opts.sink.system(
    `build memory guard: NODE_OPTIONS max-old-space-size=${nodeBuildMaxOldSpaceMb()}MB`,
  );
  for (const name of opts.envNames) args.push("--env", name);
  return args;
}

/**
 * Assemble the `docker buildx build` args: execute the railpack plan through the
 * pinned BuildKit frontend, `--load` the result into the local daemon, and tag
 * both `:<sha>` and `:latest`. Every name `prepare` declared is mounted as a
 * build secret: a declared name with no matching `--secret` fails the build
 * with "secret <NAME>: not found".
 */
export function buildBuildxArgs(opts: {
  planPath: string;
  shaTag: string;
  latestTag: string;
  buildDir: string;
  builderName?: string | null;
  cachePath?: string | null;
  noCache?: boolean | null;
  /** Builder-owned names, read from the buildx process env (`env=`). */
  secretEnvNames: string[];
  /** Service-owned names → value files (`src=`, railpack-secret-files.ts). */
  secretFiles: Record<string, string>;
  /** Digest of the service's values (railpack-env.ts), or null for none. */
  secretsHash: string | null;
}): string[] {
  return [
    "buildx",
    "build",
    ...builderFlags(opts.builderName),
    ...noCacheFlags(opts.noCache),
    "--build-arg",
    `BUILDKIT_SYNTAX=${RAILPACK_FRONTEND}`,
    // Invalidates the steps that read secrets when a value changes; BuildKit
    // itself never keys the layer cache on secret values.
    ...(opts.secretsHash ? ["--build-arg", `secrets-hash=${opts.secretsHash}`] : []),
    ...opts.secretEnvNames.flatMap((name) => ["--secret", `id=${name},env=${name}`]),
    ...Object.entries(opts.secretFiles).flatMap(([name, path]) => [
      "--secret",
      `id=${name},src=${path}`,
    ]),
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
