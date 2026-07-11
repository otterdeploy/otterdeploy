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

import type { BuildRailpackConfig } from "@otterdeploy/shared/build-config";

import { readFileSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { LogSink } from "./log-stream";

import { builderFlags, cacheFlags } from "./buildx";
import { applyPackageManager } from "./railpack-packagemanager";
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

/** Filename railpack writes its `--info-out` analysis to, inside the clone
 *  dir. Read by `detect-framework.ts` after `prepare`. */
export const RAILPACK_INFO_FILE = "railpack-info.json";

export async function railpackBuild(opts: {
  workDir: string;
  /** Service's repo subdirectory (monorepo); null/"" = repo root. */
  sourceSubdir: string | null;
  /** Full image reference without tag, e.g. "ghcr.io/acme/web". */
  imageRepository: string;
  sha: string;
  config: BuildRailpackConfig | null;
  /** Cache builder name + local cache dir (best-effort; both or neither). */
  builderName?: string | null;
  cachePath?: string | null;
  sink: LogSink;
}): Promise<{ shaTag: string; latestTag: string; buildDir: string }> {
  const shaTag = `${opts.imageRepository}:${opts.sha}`;
  const latestTag = `${opts.imageRepository}:latest`;

  const layout = await resolveBuildLayout(opts);
  const { buildDir, planPath, spaOutputDir } = layout;

  const { buildCmd, startCmd } = await resolveBuildCommands({
    workDir: opts.workDir,
    layout,
    configBuildCommand: opts.config?.buildCommand ?? null,
    sink: opts.sink,
  });

  opts.sink.system(`preparing railpack plan for ${shaTag}`);
  const prepareArgs = buildPrepareArgs({
    layout,
    buildCmd,
    startCmd,
    sink: opts.sink,
  });

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
    args: buildBuildxArgs({
      planPath,
      shaTag,
      latestTag,
      buildDir,
      spaOutputDir,
      builderName: opts.builderName,
      cachePath: opts.cachePath,
    }),
    env: {
      // Must match the value `prepare` baked into the plan (see
      // buildPrepareArgs) — the secret mount reads it from this process env.
      NODE_OPTIONS: `--max-old-space-size=${nodeBuildMaxOldSpaceMb()}`,
      ...(spaOutputDir ? { RAILPACK_SPA_OUTPUT_DIR: spaOutputDir } : {}),
    },
    sink: opts.sink,
  });
  if (built.exitCode !== 0) {
    throw new Error(buildFailureMessage(built.exitCode, built.tail));
  }

  return { shaTag, latestTag, buildDir };
}

const OOM_SIGNATURE =
  /cannot allocate memory|out of memory|ResourceExhausted|signal SIGKILL|(?:^|\s)Killed(?:\s|$)/im;

/** Non-zero buildx exits are usually app build errors, but an OOM kill looks
 *  identical to the user ("exit 1") unless we say so. The tail carries the
 *  daemon's signatures (`Killed`, `cannot allocate memory`, BuildKit's
 *  `ResourceExhausted`), so classify and attach the fix instead of leaving
 *  the operator to grep raw logs. */
function buildFailureMessage(exitCode: number, tail: string): string {
  if (OOM_SIGNATURE.test(tail)) {
    return (
      `railpack build failed (exit ${exitCode}) — the server ran out of memory during the build. ` +
      "Free up memory (Instance → Server health → Reclaim space), add 2–4 GB of swap, " +
      "or build heavy apps on a bigger machine. The build itself was killed by the kernel, " +
      "not by a code error."
    );
  }
  return `railpack build failed (exit ${exitCode})`;
}

interface BuildLayout {
  /** Service subdir (monorepo), or null when building from the repo root. */
  subdir: string | null;
  /** Repo root declares a package workspace — a subdir service builds from root. */
  isWorkspace: boolean;
  /** Build context dir passed to railpack/buildx. */
  buildDir: string;
  /** Where railpack writes the BuildKit plan. */
  planPath: string;
  /** Where railpack writes its `--info-out` analysis (read by detect-framework). */
  infoPath: string;
  /** SPA output dir relative to the build context, or null for a non-SPA build. */
  spaOutputDir: string | null;
}

/**
 * Resolve where (and how) railpack builds from the checked-out tree.
 *
 * Monorepo workspaces: when the service lives in a subdirectory of a workspace
 * repo (npm/yarn/bun `workspaces`, or pnpm-workspace.yaml), railpack MUST
 * analyse and build from the repo ROOT — that's where the lockfile, the
 * workspace catalog, and the sibling `packages/*` the app depends on live.
 * Pointed at the subdir alone it misdetects the package manager (no lockfile /
 * `packageManager` field there → falls back to npm) and the buildx context is
 * missing every workspace dependency, so install dies (e.g. `npm error
 * Unsupported URL Type "catalog:"`). We keep the root as the context and target
 * the app via cd-wrapped build/start commands (see `resolveBuildCommands`) —
 * Railpack's own recommended monorepo flow (https://railpack.com/languages/node).
 *
 * A subdir NOT inside a workspace (a self-contained app folder with its own
 * lockfile) keeps building from the subdir, exactly as before.
 *
 * `infoPath` is railpack's `--info-out` analysis (providers, runtime/framework,
 * resolved versions) written next to the plan; `detect-framework.ts` reads it
 * back from the build dir before the pipeline removes the work tree.
 */
async function resolveBuildLayout(opts: {
  workDir: string;
  sourceSubdir: string | null;
  config: BuildRailpackConfig | null;
}): Promise<BuildLayout> {
  const subdir = opts.sourceSubdir?.trim() || null;
  const isWorkspace = subdir ? await rootIsWorkspace(opts.workDir) : false;
  const buildDir = subdir && !isWorkspace ? join(opts.workDir, subdir) : opts.workDir;

  // SPA output dir is relative to the build context. For a workspace build the
  // context is the repo root, so the app's output sits under its subdir.
  const staticRoot = opts.config?.spa
    ? opts.config.staticRoot?.trim() || DEFAULT_STATIC_ROOT
    : null;
  // For a workspace build the context is the repo root, so the app's output
  // sits under its subdir — prepend it. Guard against a staticRoot that ALREADY
  // carries the subdir (older configs stored the repo-root-relative
  // `<subdir>/dist`): prepending again produced `apps/web/apps/web/dist` and the
  // COPY step failed. Only prepend when it isn't already subdir-qualified.
  const spaOutputDir = staticRoot
    ? isWorkspace && subdir && staticRoot !== subdir && !staticRoot.startsWith(`${subdir}/`)
      ? `${subdir}/${staticRoot}`
      : staticRoot
    : null;

  return {
    subdir,
    isWorkspace,
    buildDir,
    planPath: join(buildDir, "railpack-plan.json"),
    infoPath: join(buildDir, RAILPACK_INFO_FILE),
    spaOutputDir,
  };
}

/**
 * Derive the build/start commands for the railpack `prepare` step.
 *
 * Non-workspace builds: pass the user's build command through unchanged and let
 * railpack auto-detect the start command. Workspace builds: derive both from the
 * app's own package.json and run them inside its subdir (node resolves the
 * hoisted root node_modules) — railpack analysing the root finds no start script
 * and would fail `--error-missing-start`.
 */
async function resolveBuildCommands(opts: {
  workDir: string;
  layout: BuildLayout;
  configBuildCommand: string | null;
  sink: LogSink;
}): Promise<{ buildCmd: string | null; startCmd: string | null }> {
  const { subdir, isWorkspace, spaOutputDir } = opts.layout;
  const configBuild = opts.configBuildCommand?.trim() || null;

  if (!isWorkspace || !subdir) {
    return { buildCmd: configBuild, startCmd: null };
  }

  const appPkg = await readJson<{ scripts?: Record<string, string> }>(
    join(opts.workDir, subdir, "package.json"),
  );
  const scripts = appPkg?.scripts ?? {};
  const pmRun = await detectPackageManagerRun(opts.workDir);

  const rawBuild = configBuild ?? (scripts.build ? `${pmRun} build` : null);
  const buildCmd = rawBuild ? `cd ${subdir} && ${rawBuild}` : null;
  // SPA images are served by Caddy and need no start command. Otherwise wrap the
  // app's own start script so the container boots the right workspace app.
  const startCmd = !spaOutputDir && scripts.start ? `cd ${subdir} && ${pmRun} start` : null;

  opts.sink.system(
    `monorepo workspace build: context=repo root, app="${subdir}"` +
      (buildCmd ? `, build="${buildCmd}"` : "") +
      (startCmd ? `, start="${startCmd}"` : ""),
  );

  return { buildCmd, startCmd };
}

/**
 * Assemble the `railpack prepare` args. `--error-missing-start` fails the build
 * LOUDLY at analysis time when railpack can't find a way to start the app,
 * instead of emitting a runnable-less image that builds fine but exits on boot
 * (surfacing only as an opaque "swarm convergence failed" much later — railpack
 * instead prints an actionable message: add a `start` script, a `main` field, or
 * set RAILPACK_SPA_OUTPUT_DIR for a static site). A static SPA rides on the
 * `--env RAILPACK_SPA_OUTPUT_DIR` flag, which railpack reads at prepare time.
 */
/** Cap V8's old-space heap for the JS build step so a heavy build
 *  (vite/webpack/next) GCs under pressure instead of ballooning and letting the
 *  host OOM-killer take down buildkitd (observed: a `vite build` OOM-killed the
 *  cache builder mid-run). Sized to ~60% of host RAM (from /proc/meminfo),
 *  clamped to a sane band; a conservative default when host RAM is unknown. */
function nodeBuildMaxOldSpaceMb(): number {
  try {
    const kb = Number(/^MemTotal:\s+(\d+) kB/m.exec(readFileSync("/proc/meminfo", "utf8"))?.[1]);
    const totalMb = Math.floor(kb / 1024);
    if (totalMb > 0) return Math.max(1024, Math.min(Math.floor(totalMb * 0.6), 6144));
  } catch {
    // /proc unavailable (non-Linux, restricted) — fall through to the default.
  }
  return 2048;
}

function buildPrepareArgs(opts: {
  layout: BuildLayout;
  buildCmd: string | null;
  startCmd: string | null;
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
  return args;
}

/**
 * Assemble the `docker buildx build` args: execute the railpack plan through the
 * pinned BuildKit frontend, `--load` the result into the local daemon, and tag
 * both `:<sha>` and `:latest`. A static SPA additionally forwards the output dir
 * as a build secret so the plan can resolve `RAILPACK_SPA_OUTPUT_DIR`.
 */
function buildBuildxArgs(opts: {
  planPath: string;
  shaTag: string;
  latestTag: string;
  buildDir: string;
  spaOutputDir: string | null;
  builderName?: string | null;
  cachePath?: string | null;
}): string[] {
  return [
    "buildx",
    "build",
    ...builderFlags(opts.builderName),
    "--build-arg",
    `BUILDKIT_SYNTAX=${RAILPACK_FRONTEND}`,
    ...(opts.spaOutputDir
      ? ["--secret", "id=RAILPACK_SPA_OUTPUT_DIR,env=RAILPACK_SPA_OUTPUT_DIR"]
      : []),
    // prepare always injects NODE_OPTIONS (the build memory guard), which the
    // generated plan consumes as a build secret — same mechanism as the SPA
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
    ...cacheFlags(opts.builderName, opts.cachePath),
    opts.buildDir,
  ];
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
  const pkg = await readJson<{ workspaces?: unknown }>(join(workDir, "package.json"));
  const ws = pkg?.workspaces;
  if (Array.isArray(ws) && ws.length > 0) return true;
  if (ws && typeof ws === "object" && "packages" in ws && Array.isArray(ws.packages)) {
    return true;
  }
  return fileExists(join(workDir, "pnpm-workspace.yaml"));
}

/** The `<pm> run` prefix used to invoke a workspace app's scripts, derived from
 *  the root `packageManager` field then lockfile presence. npm/bun/pnpm/yarn all
 *  accept `<pm> run <script>`. */
async function detectPackageManagerRun(workDir: string): Promise<string> {
  const pkg = await readJson<{ packageManager?: string }>(join(workDir, "package.json"));
  const declared = pkg?.packageManager?.split("@")[0]?.trim();
  if (declared === "bun" || declared === "pnpm" || declared === "yarn" || declared === "npm") {
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
