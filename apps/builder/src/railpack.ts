/**
 * Build an image from a checked-out work tree with Railpack.
 *
 * Unlike nixpacks (which shells out to a single `nixpacks build` that
 * loads straight into the local Docker daemon), Railpack is a two-step,
 * BuildKit-native flow:
 *
 *   1. `railpack prepare <dir> --plan-out <dir>/railpack-plan.json`
 *      Analyses the source and emits a BuildKit plan.
 *   2. `docker buildx build --build-arg BUILDKIT_SYNTAX=<frontend>
 *         -f <plan> --load -t <sha> -t <latest> <dir>`
 *      Executes the plan through Railpack's BuildKit frontend and
 *      `--load`s the result into the local Docker daemon, so the
 *      existing `dockerPush` step pushes it unchanged.
 *
 * For static sites (Vite / React / Vue / Angular) Railpack produces an
 * image that runs Caddy to serve the built assets with SPA history
 * fallback. Railpack keys this off the `RAILPACK_SPA_OUTPUT_DIR` env var
 * (read at `prepare` time) pointing at the build output dir — NOT the
 * Cloud-Foundry-style `Staticfile` that nixpacks used; railpack ignores
 * that file. When `spa` is set we pass `--env RAILPACK_SPA_OUTPUT_DIR=
 * <staticRoot>` to `prepare` (default `dist`, Vite's output), and expose
 * the same value to the generated BuildKit plan as a secret.
 *
 * Two tags are produced for every successful build: the immutable
 * `:<sha>` tag (what the deployment row points at) and the moving
 * `:latest` tag.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { BuildRailpackConfig } from "@otterdeploy/shared/build-config";

import type { LogSink } from "./log-stream";
import { runProcess } from "./run-process";

/** Frontend image that executes the BuildKit plan. Pinned to an explicit tag
 *  (NOT `latest`) and kept in lockstep with the railpack CLI version installed
 *  in the Dockerfile (ARG RAILPACK_VERSION) — the plan format and the frontend
 *  that runs it must agree, or BuildKit fails with cryptic errors like
 *  "secret RAILPACK_SPA_OUTPUT_DIR: not found". Bump both together. */
const RAILPACK_FRONTEND = "ghcr.io/railwayapp/railpack-frontend:v0.26.1";

/** Vite's default output dir; overridable via `config.staticRoot` for
 *  frameworks that emit elsewhere (e.g. CRA's `build`). */
const DEFAULT_STATIC_ROOT = "dist";

/** Lowest bun version we'll build with. bun 1.3.1 (and earlier 1.3.x) abort
 *  `bun install` on Linux ARM64 while building optional native deps
 *  (msgpackr-extract via node-gyp-build-optional-packages); 1.3.13 fixed it.
 *  A repo pinning an older bun is transparently bumped to this floor so the
 *  deploy doesn't fail on a known-broken upstream release. An explicit
 *  `config.packageManager` override always wins over this. */
const MIN_BUN_VERSION = "1.3.13";

/** Filename railpack writes its `--info-out` analysis to, inside the clone
 *  dir. Read by `detect-framework.ts` after `prepare`. */
export const RAILPACK_INFO_FILE = "railpack-info.json";

export async function railpackBuild(opts: {
  workDir: string;
  /** Service's repo subdirectory (monorepo); null/"" = repo root. The build
   *  runs against this dir, NOT the clone root — railpack analyses a monorepo
   *  root as a workspace and finds no start command, producing a runnable-less
   *  image whose container exits on boot (swarm never converges). */
  sourceSubdir: string | null;
  /** Full image reference without tag, e.g. "ghcr.io/acme/web". */
  imageRepository: string;
  sha: string;
  config: BuildRailpackConfig | null;
  sink: LogSink;
}): Promise<{ shaTag: string; latestTag: string }> {
  const shaTag = `${opts.imageRepository}:${opts.sha}`;
  const latestTag = `${opts.imageRepository}:latest`;
  // For a monorepo service, build the subdirectory holding the app (where its
  // package.json lives) — railpack detects the framework + start command there.
  // Pointed at the clone root it sees a multi-package workspace and bails on the
  // start command. The buildx context is this same dir.
  const buildDir = opts.sourceSubdir
    ? join(opts.workDir, opts.sourceSubdir)
    : opts.workDir;
  const planPath = join(buildDir, "railpack-plan.json");
  // railpack's `prepare` also emits a machine-readable analysis of what it
  // detected (providers, node runtime/framework, resolved package versions).
  // We ask for it via `--info-out` and read it back to capture the service's
  // framework for the graph logo — no second invocation, no git-API call.
  // Written next to the plan in the build dir; `detect-framework.ts` reads it
  // (from the same subdir) before the pipeline removes the work tree.
  const infoPath = join(buildDir, RAILPACK_INFO_FILE);
  const spaOutputDir = opts.config?.spa
    ? opts.config.staticRoot?.trim() || DEFAULT_STATIC_ROOT
    : null;

  opts.sink.system(`preparing railpack plan for ${shaTag}`);
  const prepareArgs = [
    "prepare",
    buildDir,
    "--plan-out",
    planPath,
    "--info-out",
    infoPath,
    // Fail the build LOUDLY at analysis time when railpack can't find a way to
    // start the app, instead of emitting a runnable-less image that builds fine
    // but exits on boot — surfacing only as an opaque "swarm convergence failed"
    // much later. railpack prints an actionable message (add a `start` script,
    // a `main` field, or set RAILPACK_SPA_OUTPUT_DIR for a static site).
    "--error-missing-start",
  ];
  if (opts.config?.buildCommand) {
    prepareArgs.push("--build-cmd", opts.config.buildCommand);
  }
  // Static SPA: railpack emits a Caddy image serving the built assets with
  // history fallback when RAILPACK_SPA_OUTPUT_DIR names the build output dir.
  // It's read at prepare time, so it has to ride on the `prepare` invocation.
  if (spaOutputDir) {
    prepareArgs.push("--env", `RAILPACK_SPA_OUTPUT_DIR=${spaOutputDir}`);
    opts.sink.system(
      `SPA mode: serving "${spaOutputDir}" via Caddy with history fallback`,
    );
  }
  // Package-manager pinning: rewrite the repo's `packageManager` field before
  // railpack reads it. This is the one lever that works across every manager —
  // bun resolves its version from `packageManager` via mise, while pnpm/yarn/
  // npm are installed by Corepack, which reads the same field directly. An env
  // override (RAILPACK_PACKAGES) only reaches the bun/mise path, not Corepack,
  // so we rewrite the field itself. Applies an explicit override (UI/manifest)
  // if set, otherwise auto-bumps a known-broken bun pin to MIN_BUN_VERSION so
  // deploys don't fail on bun 1.3.1's broken native install on Linux ARM64.
  await applyPackageManager(buildDir, opts.config?.packageManager, opts.sink);

  const prepared = await runProcess({
    cmd: "railpack",
    args: prepareArgs,
    sink: opts.sink,
  });
  if (prepared.exitCode !== 0) {
    throw new Error(`railpack prepare failed (exit ${prepared.exitCode})`);
  }

  opts.sink.system(`building image ${shaTag} with railpack`);
  const built = await runProcess({
    cmd: "docker",
    args: [
      "buildx",
      "build",
      "--build-arg",
      `BUILDKIT_SYNTAX=${RAILPACK_FRONTEND}`,
      ...(spaOutputDir
        ? ["--secret", "id=RAILPACK_SPA_OUTPUT_DIR,env=RAILPACK_SPA_OUTPUT_DIR"]
        : []),
      "-f",
      planPath,
      "--load",
      "-t",
      shaTag,
      "-t",
      latestTag,
      buildDir,
    ],
    env: spaOutputDir ? { RAILPACK_SPA_OUTPUT_DIR: spaOutputDir } : undefined,
    sink: opts.sink,
  });
  if (built.exitCode !== 0) {
    throw new Error(`railpack build failed (exit ${built.exitCode})`);
  }

  return { shaTag, latestTag };
}

/**
 * Rewrite the repo's `packageManager` field so railpack/Corepack install a
 * known-good toolchain instead of whatever the repo declared. Rewrites the
 * `package.json` in the build dir — the one railpack actually reads (the
 * service's subdir for a monorepo, else the clone root).
 *
 * Resolution (see `resolvePackageManager`):
 *   1. explicit `override` (UI / manifest) always wins — the escape hatch.
 *   2. else auto-bump a bun pin below MIN_BUN_VERSION to the floor.
 *   3. else leave the repo's field untouched.
 *
 * No-ops when nothing needs changing or there's no `package.json` there. The
 * clone is an ephemeral tmpfs dir, so this never touches the user's repo.
 */
async function applyPackageManager(
  buildDir: string,
  override: string | null | undefined,
  sink: LogSink,
): Promise<void> {
  const pkgPath = join(buildDir, "package.json");
  let raw: string;
  try {
    raw = await readFile(pkgPath, "utf8");
  } catch {
    const explicit = override?.trim();
    if (explicit) {
      sink.system(
        `packageManager override "${explicit}" skipped — no root package.json`,
      );
    }
    return;
  }

  const pkg = JSON.parse(raw) as { packageManager?: string };
  const previous = pkg.packageManager;
  const pinned = resolvePackageManager(override, previous, sink);
  if (!pinned || pinned === previous) return;

  pkg.packageManager = pinned;
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  sink.system(`pinned packageManager ${previous ?? "(unset)"} → ${pinned}`);
}

/**
 * Decide the `packageManager` value to build with. Returns the new value, or
 * null to leave the repo's field as-is. See `applyPackageManager` for the order.
 */
function resolvePackageManager(
  override: string | null | undefined,
  current: string | undefined,
  sink: LogSink,
): string | null {
  const explicit = override?.trim();
  if (explicit) return explicit;

  // Auto-heal: only bun is known to ship a broken release we must dodge.
  // `packageManager` is always `<name>@<version>(+<hash>)?`.
  if (!current) return null;
  const [name, versionSpec] = current.split("@");
  if (name !== "bun" || !versionSpec) return null;

  const version = versionSpec.split(/[+-]/)[0] ?? versionSpec;
  if (compareVersions(version, MIN_BUN_VERSION) >= 0) return null;

  sink.system(
    `repo pins bun@${version} — below the supported floor; building with bun@${MIN_BUN_VERSION}`,
  );
  return `bun@${MIN_BUN_VERSION}`;
}

/** Compare dotted numeric versions (`1.3.1` vs `1.3.13`). Returns <0 / 0 / >0.
 *  Ignores any `+build` / `-prerelease` suffix — enough for the bun floor. */
function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    (v.split(/[+-]/)[0] ?? v)
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const av = parts(a);
  const bv = parts(b);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const diff = (av[i] ?? 0) - (bv[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
