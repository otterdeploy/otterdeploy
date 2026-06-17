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

import { access, readFile, writeFile } from "node:fs/promises";
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
const RAILPACK_INFO_FILE = "railpack-info.json";

async function railpackBuild(opts: {
  workDir: string;
  /** Service's repo subdirectory (monorepo); null/"" = repo root. */
  sourceSubdir: string | null;
  /** Full image reference without tag, e.g. "ghcr.io/acme/web". */
  imageRepository: string;
  sha: string;
  config: BuildRailpackConfig | null;
  sink: LogSink;
}): Promise<{ shaTag: string; latestTag: string; buildDir: string }> {
  const shaTag = `${opts.imageRepository}:${opts.sha}`;
  const latestTag = `${opts.imageRepository}:latest`;

  const subdir = opts.sourceSubdir?.trim() || null;

  // Monorepo workspaces: when the service lives in a subdirectory of a workspace
  // repo (npm/yarn/bun `workspaces`, or pnpm-workspace.yaml), railpack MUST
  // analyse and build from the repo ROOT — that's where the lockfile, the
  // workspace catalog, and the sibling `packages/*` the app depends on live.
  // Pointed at the subdir alone it misdetects the package manager (no
  // lockfile / `packageManager` field there → falls back to npm) and the buildx
  // context is missing every workspace dependency, so install dies (e.g.
  // `npm error Unsupported URL Type "catalog:"`). Instead keep the root as the
  // context and target the app via cd-wrapped build/start commands — Railpack's
  // own recommended monorepo flow (https://railpack.com/languages/node).
  //
  // A subdir that is NOT inside a workspace (a self-contained app folder with
  // its own lockfile) keeps building from the subdir, exactly as before — there
  // railpack detects the framework + start command directly.
  const isWorkspace = subdir ? await rootIsWorkspace(opts.workDir) : false;
  const buildDir =
    subdir && !isWorkspace ? join(opts.workDir, subdir) : opts.workDir;
  const planPath = join(buildDir, "railpack-plan.json");
  // railpack's `prepare` also emits a machine-readable analysis of what it
  // detected (providers, node runtime/framework, resolved package versions).
  // We ask for it via `--info-out` and read it back to capture the service's
  // framework for the graph logo — no second invocation, no git-API call.
  // Written next to the plan in the build dir; `detect-framework.ts` reads it
  // back from this same dir before the pipeline removes the work tree.
  const infoPath = join(buildDir, RAILPACK_INFO_FILE);

  // SPA output dir is relative to the build context. For a workspace build the
  // context is the repo root, so the app's output sits under its subdir.
  const staticRoot = opts.config?.spa
    ? opts.config.staticRoot?.trim() || DEFAULT_STATIC_ROOT
    : null;
  const spaOutputDir = staticRoot
    ? isWorkspace && subdir
      ? `${subdir}/${staticRoot}`
      : staticRoot
    : null;

  // Non-workspace builds: pass the user's build command through unchanged and
  // let railpack auto-detect the start command. Workspace builds: derive both
  // from the app's own package.json and run them inside its subdir (node
  // resolves the hoisted root node_modules) — railpack analysing the root finds
  // no start script and would fail `--error-missing-start`.
  let buildCmd = opts.config?.buildCommand?.trim() || null;
  let startCmd: string | null = null;
  if (isWorkspace && subdir) {
    const appPkg = await readJson<{ scripts?: Record<string, string> }>(
      join(opts.workDir, subdir, "package.json"),
    );
    const scripts = appPkg?.scripts ?? {};
    const pmRun = await detectPackageManagerRun(opts.workDir);
    const rawBuild = buildCmd ?? (scripts.build ? `${pmRun} run build` : null);
    buildCmd = rawBuild ? `cd ${subdir} && ${rawBuild}` : null;
    // SPA images are served by Caddy and need no start command. Otherwise wrap
    // the app's own start script so the container boots the right workspace app.
    if (!spaOutputDir && scripts.start) {
      startCmd = `cd ${subdir} && ${pmRun} run start`;
    }
    opts.sink.system(
      `monorepo workspace build: context=repo root, app="${subdir}"` +
        (buildCmd ? `, build="${buildCmd}"` : "") +
        (startCmd ? `, start="${startCmd}"` : ""),
    );
  }

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
  if (buildCmd) prepareArgs.push("--build-cmd", buildCmd);
  if (startCmd) prepareArgs.push("--start-cmd", startCmd);
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

  return { shaTag, latestTag, buildDir };
}

/** Read + JSON.parse a file, returning null on any error (missing/malformed). */
async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** True when the repo root declares a package workspace — npm/yarn/bun via the
 *  `workspaces` field (string[] or bun's `{ packages: [] }`), pnpm via
 *  pnpm-workspace.yaml. This is the signal that a subdir service must build from
 *  the root so its lockfile, catalog, and sibling packages resolve. */
async function rootIsWorkspace(workDir: string): Promise<boolean> {
  const pkg = await readJson<{ workspaces?: unknown }>(
    join(workDir, "package.json"),
  );
  const ws = pkg?.workspaces;
  if (Array.isArray(ws) && ws.length > 0) return true;
  if (
    ws &&
    typeof ws === "object" &&
    Array.isArray((ws as { packages?: unknown }).packages)
  ) {
    return true;
  }
  return fileExists(join(workDir, "pnpm-workspace.yaml"));
}

/** The `<pm> run` prefix used to invoke a workspace app's scripts, derived from
 *  the root `packageManager` field then lockfile presence. npm/bun/pnpm/yarn all
 *  accept `<pm> run <script>`. */
async function detectPackageManagerRun(workDir: string): Promise<string> {
  const pkg = await readJson<{ packageManager?: string }>(
    join(workDir, "package.json"),
  );
  const declared = pkg?.packageManager?.split("@")[0]?.trim();
  if (
    declared === "bun" ||
    declared === "pnpm" ||
    declared === "yarn" ||
    declared === "npm"
  ) {
    return `${declared} run`;
  }
  if (
    (await fileExists(join(workDir, "bun.lock"))) ||
    (await fileExists(join(workDir, "bun.lockb")))
  ) {
    return "bun run";
  }
  if (await fileExists(join(workDir, "pnpm-lock.yaml"))) return "pnpm run";
  if (await fileExists(join(workDir, "yarn.lock"))) return "yarn run";
  return "npm run";
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
