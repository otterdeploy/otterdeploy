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
 * (read at `prepare` time) pointing at the build output dir, NOT the
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
import { join } from "node:path";
import * as z from "zod";

import type { LogSink } from "./log-stream";

import { NO_TURBO_CACHE, type TurboCacheEnv, turboForceEnv } from "./buildx";
import { buildBuildxArgs, buildPrepareArgs, nodeBuildMaxOldSpaceMb } from "./railpack-args";
import { readJson, tanstackStartCommand } from "./railpack-detect";
import { type BuildLayout, resolveBuildLayout } from "./railpack-layout";
import { applyPackageManager } from "./railpack-packagemanager";
import { TURBO_CACHE_DIR, injectTurboCache } from "./railpack-plan";
import { runProcess } from "./run-process";
import { pruneWorkspace } from "./turbo-prune";
import {
  type WorkspaceRunner,
  assertTurboRanTasks,
  resolveWorkspaceRunner,
  workspaceBuildCommand,
} from "./turbo-runner";

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
  /** Per-deploy cache bypass ("Redeploy without cache"). */
  noCache?: boolean | null;
  /** Turbo remote-cache credentials, empty when disabled. */
  turboCache?: TurboCacheEnv;
  sink: LogSink;
}): Promise<{ shaTag: string; latestTag: string; buildDir: string }> {
  const shaTag = `${opts.imageRepository}:${opts.sha}`;
  const latestTag = `${opts.imageRepository}:latest`;
  const turboCache = opts.turboCache ?? NO_TURBO_CACHE;

  const plan = await resolveBuildPlan(opts);
  const { layout, buildCmd, startCmd, runner } = plan;
  const runnerUsesTurbo = runner?.kind === "turbo";
  const { buildDir, planPath, spaOutputDir } = layout;

  opts.sink.system(`preparing railpack plan for ${shaTag}`);
  const prepareArgs = buildPrepareArgs({
    layout,
    buildCmd,
    startCmd,
    // Declared to railpack by NAME only: `prepare --env K=V` records K in the
    // plan's `secrets` list and never writes V to disk (verified against the
    // pinned railpack), so the real value travels solely via buildx --secret.
    extraEnv: {
      ...turboCache.env,
      ...turboForceEnv(opts.noCache),
      ...(runnerUsesTurbo ? { TURBO_CACHE_DIR } : {}),
    },
    sink: opts.sink,
  });

  // Package-manager pinning: rewrite the repo's `packageManager` field before
  // railpack reads it. This is the one lever that works across every manager.
  // Bun resolves its version from `packageManager` via mise, while pnpm/yarn/
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

  // The plan is now on disk and names the provider actually chosen. Check it
  // against what we told railpack to serve BEFORE spending a build on it.
  assertProviderCanServeSpa({ layout });

  // Turbo's own cache dir is cold on every build (fresh clone per deployment)
  // unless it rides a BuildKit cache mount. Railpack has no flag for that, but
  // the plan is ours to amend before buildx reads it. Best-effort.
  if (runnerUsesTurbo) await injectTurboCache(planPath, opts.sink);

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
      noCache: opts.noCache,
      extraSecretFlags: [
        ...turboCache.secretFlags,
        ...(opts.noCache ? ["--secret", "id=TURBO_FORCE,env=TURBO_FORCE"] : []),
        ...(runnerUsesTurbo ? ["--secret", "id=TURBO_CACHE_DIR,env=TURBO_CACHE_DIR"] : []),
      ],
    }),
    env: {
      // Must match the value `prepare` baked into the plan (see
      // buildPrepareArgs): the secret mount reads it from this process env.
      NODE_OPTIONS: `--max-old-space-size=${nodeBuildMaxOldSpaceMb()}`,
      ...(spaOutputDir ? { RAILPACK_SPA_OUTPUT_DIR: spaOutputDir } : {}),
      ...turboCache.env,
      ...turboForceEnv(opts.noCache),
      ...(runnerUsesTurbo ? { TURBO_CACHE_DIR } : {}),
    },
    sink: opts.sink,
  });
  if (built.exitCode !== 0) {
    throw new Error(buildFailureMessage(built.exitCode, built.tail));
  }
  // A turbo build that matched nothing exits 0 having run no tasks. Catch it
  // here rather than shipping an image with no build output.
  if (runner) assertTurboRanTasks({ runner, buildLog: built.tail });

  return { shaTag, latestTag, buildDir };
}

/**
 * Resolve the layout and the build/start commands, optionally re-resolving
 * both against a pruned copy of the workspace.
 *
 * Pruning happens after the first pass because the turbo filter comes from the
 * runner. The pruned tree is shaped exactly like the clone (same `apps/`,
 * `packages/`, lockfile), so re-resolving against it yields the same
 * subdir/SPA answers over a smaller context. `pruneWorkspace` returns null
 * whenever pruning is impossible or unsafe, and then this is a single pass.
 */
async function resolveBuildPlan(opts: {
  workDir: string;
  sourceSubdir: string | null;
  config: BuildRailpackConfig | null;
  sink: LogSink;
}): Promise<{
  layout: BuildLayout;
  buildCmd: string | null;
  startCmd: string | null;
  runner: WorkspaceRunner | null;
}> {
  const resolve = async (workDir: string) => {
    const layout = await resolveBuildLayout({ ...opts, workDir });
    const commands = await resolveBuildCommands({
      workDir,
      layout,
      configBuildCommand: opts.config?.buildCommand ?? null,
      config: opts.config,
      sink: opts.sink,
    });
    return { layout, ...commands };
  };

  const first = await resolve(opts.workDir);
  if (first.runner?.kind !== "turbo" || !opts.config?.turboPrune) return first;

  const prunedDir = await pruneWorkspace({
    workDir: opts.workDir,
    filter: first.runner.filter,
    sink: opts.sink,
  });
  return prunedDir ? await resolve(prunedDir) : first;
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
      `railpack build failed (exit ${exitCode}): the server ran out of memory during the build. ` +
      "Free up memory (Instance → Server health → Reclaim space), add 2–4 GB of swap, " +
      "or build heavy apps on a bigger machine. The build itself was killed by the kernel, " +
      "not by a code error."
    );
  }
  return `railpack build failed (exit ${exitCode})`;
}

/**
 * Derive the build/start commands for the railpack `prepare` step.
 *
 * Non-workspace builds: pass the user's build command through unchanged and let
 * railpack auto-detect the start command. Workspace builds: derive both from the
 * app's own package.json and run them inside its subdir (node resolves the
 * hoisted root node_modules): railpack analysing the root finds no start script
 * and would fail `--error-missing-start`.
 */
async function resolveBuildCommands(opts: {
  workDir: string;
  layout: BuildLayout;
  configBuildCommand: string | null;
  config: BuildRailpackConfig | null;
  sink: LogSink;
}): Promise<{ buildCmd: string | null; startCmd: string | null; runner: WorkspaceRunner | null }> {
  const { subdir, isWorkspace, spaOutputDir } = opts.layout;
  const configBuild = opts.configBuildCommand?.trim() || null;

  if (!isWorkspace || !subdir) {
    // railpack auto-detects the start command for a single-app build. Except it
    // mis-detects TanStack Start (SSR, builds to `.output/`) as a static site and
    // bakes a `COPY /app/dist` that never exists. tanstackStartCommand forces the
    // app's own start script in that case (server deploy), else returns null and
    // leaves railpack's auto-detection alone.
    const startCmd = await tanstackStartCommand(opts.layout.buildDir, spaOutputDir, opts.sink);
    return { buildCmd: configBuild, startCmd, runner: null };
  }

  const appPkg = await readJson<{ scripts?: Record<string, string> }>(
    join(opts.workDir, subdir, "package.json"),
  );
  const scripts = appPkg?.scripts ?? {};

  // Turbo is a task runner over the workspace we already established above; it
  // decides only WHAT builds the app, never where the context is anchored.
  const runner = await resolveWorkspaceRunner({
    workDir: opts.workDir,
    subdir,
    configured: opts.config?.buildRunner,
    configuredFilter: opts.config?.turboFilter,
    sink: opts.sink,
  });

  // An explicit build command always wins; it is run from the repo root under
  // turbo (which is where turbo must run) and cd-ed into the app otherwise,
  // matching each runner's own convention.
  const buildCmd = configBuild
    ? runner.kind === "turbo"
      ? configBuild
      : `cd ${subdir} && ${configBuild}`
    : workspaceBuildCommand({ runner, subdir, hasBuildScript: Boolean(scripts.build) });

  // SPA images are served by Caddy and need no start command. Otherwise wrap the
  // app's own start script so the container boots the right workspace app. This
  // is deliberately NOT routed through turbo: turbo belongs to the build, and a
  // `turbo run start` in the runtime image would ship the whole toolchain.
  const startCmd = !spaOutputDir && scripts.start ? `cd ${subdir} && ${runner.pmRun} start` : null;

  opts.sink.system(
    `monorepo workspace build: context=repo root, app="${subdir}", runner=${runner.kind}` +
      (buildCmd ? `, build="${buildCmd}"` : "") +
      (startCmd ? `, start="${startCmd}"` : ""),
  );

  return { buildCmd, startCmd, runner };
}

/**
 * Providers that ship files as-is: they run no build step, so whatever is in
 * the repo is what gets served. Asking one of these to serve a build *output*
 * directory is a contradiction. Nothing will ever create it.
 */
const NON_BUILDING_PROVIDERS = new Set(["staticfile"]);

/** The one field we read out of Railpack's `--info-out` analysis JSON. A
 *  shape mismatch is treated like a missing/absent list (no invented
 *  failure), same as the pre-parse behavior for an absent field. */
const railpackInfoSchema = z.object({ detectedProviders: z.array(z.string()).optional() });

/**
 * Refuse a build whose declared SPA output directory the chosen provider can
 * never produce.
 *
 * The incident: a service configured `spa` with output `dist` logged
 * `SPA mode: serving "dist" via Caddy with history fallback`, and only
 * afterwards did railpack report `↳ Detected Staticfile`. The Staticfile
 * provider's entire build was `caddy fmt --overwrite Caddyfile`. It never runs
 * a bundler, so the image shipped a Caddy rooted at a `dist/` that did not
 * exist. Every request 404'd. The two log lines contradicted each other on
 * screen, in order, and the build proceeded anyway.
 *
 * The mismatch is knowable the moment `prepare` writes its analysis, which is
 * before a single layer is pulled. Fail there, with the fix in the message,
 * rather than shipping an image that is guaranteed to serve nothing.
 */
export function assertProviderCanServeSpa(opts: {
  layout: Pick<BuildLayout, "spaOutputDir" | "infoPath">;
}): void {
  const { spaOutputDir, infoPath } = opts.layout;
  if (!spaOutputDir) return;

  let providers: string[];
  try {
    const info = railpackInfoSchema.safeParse(JSON.parse(readFileSync(infoPath, "utf8")));
    providers = info.success ? (info.data.detectedProviders ?? []) : [];
  } catch {
    // No analysis to read: don't invent a failure from a missing file. The
    // build proceeds exactly as it did before this check existed.
    return;
  }

  const offending = providers.filter((p) => NON_BUILDING_PROVIDERS.has(p.toLowerCase()));
  if (offending.length === 0 || offending.length !== providers.length) return;

  throw new Error(
    `This service is set to serve the build output directory "${spaOutputDir}", but Railpack ` +
      `detected only the ${offending.join(", ")} provider, which runs no build step and would ` +
      `serve an empty directory. Railpack usually falls back to Staticfile when it cannot find a ` +
      `project manifest. Check that the root directory contains the package.json (or Dockerfile) ` +
      `for this app.`,
  );
}
