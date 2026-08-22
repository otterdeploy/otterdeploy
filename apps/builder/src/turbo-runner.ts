/**
 * Turborepo support for workspace builds.
 *
 * The distinction that shapes this whole file: **turbo is a task runner over a
 * workspace, it never creates one.** npm/yarn/bun `workspaces` or
 * pnpm-workspace.yaml define the workspace; `turbo.json` only says "there is a
 * task graph here". So `rootIsWorkspace` stays the gate that decides the build
 * CONTEXT (see `resolveBuildLayout`), and turbo is a capability discovered
 * inside an already-established workspace that changes only the build COMMAND.
 * A `turbo.json` in a non-workspace repo is a misconfigured repo, not a
 * monorepo, and is ignored.
 *
 * Why it matters: the previous workspace build ran
 * `cd apps/web && bun run build`, which builds the app and nothing else. A
 * turborepo app almost always imports internal packages that compile to
 * `dist/` (tsup/tsc). Nothing built them, so the build either died on a missing
 * import or — worse — succeeded against a stale `dist/` committed earlier.
 * `turbo run build --filter=<pkg>` walks the dependency graph and builds them
 * in order, which is the entire reason the repo has a turbo.json.
 */

import { join } from "node:path";

import type { LogSink } from "./log-stream";

import { detectPackageManagerRun, readJson } from "./railpack-detect";

/** How the app's build command is produced for a workspace build. */
export type WorkspaceRunner =
  | {
      kind: "turbo";
      /** `--filter` value: the app's package name, or a `./path` fallback. */
      filter: string;
      /** `<pm> run` prefix; turbo is invoked through it so no global install
       *  is needed (`bun run turbo …` resolves the workspace-local binary). */
      pmRun: string;
    }
  | { kind: "script"; pmRun: string };

/** Only the fields the runner reads. */
interface AppPkg {
  name?: string;
  scripts?: Record<string, string>;
}

/** Root package.json fields that prove turbo is actually installed. A
 *  `turbo.json` with no turbo dependency would leave `turbo run` unresolvable
 *  inside the build container. */
interface RootPkg {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  packageManager?: string;
}

/**
 * Is turbo usable at this repo root? Requires BOTH a `turbo.json` (the task
 * graph) and a `turbo` dependency (the binary). Presence of only one is a
 * broken setup, and we say so rather than emitting a command that will fail
 * inside the container with `turbo: command not found`.
 */
export async function detectTurbo(workDir: string): Promise<{
  usable: boolean;
  /** Why turbo was rejected, for the log. Null when usable or absent. */
  reason: string | null;
}> {
  const config = await readJson<unknown>(join(workDir, "turbo.json"));
  const rootPkg = await readJson<RootPkg>(join(workDir, "package.json"));
  const deps = { ...rootPkg?.dependencies, ...rootPkg?.devDependencies };
  const hasDep = "turbo" in deps;

  if (!config && !hasDep) return { usable: false, reason: null };
  if (config && !hasDep) {
    return {
      usable: false,
      reason:
        "found turbo.json but no turbo dependency at the repo root; building with the app's own build script instead",
    };
  }
  if (!config && hasDep) {
    return {
      usable: false,
      reason:
        "repo depends on turbo but has no turbo.json at the root; building with the app's own build script instead",
    };
  }
  return { usable: true, reason: null };
}

/**
 * The `--filter` value for an app.
 *
 * Turbo filters on the PACKAGE NAME from the app's package.json, not the
 * directory. Passing a directory where a name is expected matches nothing, and
 * `turbo run build --filter=apps/web` with no match exits 0 having run zero
 * tasks — a build that "succeeds" and ships an image with no build output. The
 * `./path` form is turbo's documented directory filter and is always valid, so
 * it's the fallback when the package has no name.
 */
export async function resolveTurboFilter(workDir: string, subdir: string): Promise<string> {
  const pkg = await readJson<AppPkg>(join(workDir, subdir, "package.json"));
  const name = pkg?.name?.trim();
  return name || `./${subdir}`;
}

/**
 * Decide how a workspace app's build command is produced.
 *
 * Only ever called once the build context is already the repo root, i.e. the
 * root is a workspace and the service lives in a subdir of it.
 */
export async function resolveWorkspaceRunner(opts: {
  workDir: string;
  subdir: string;
  configured: "auto" | "turbo" | "script" | null | undefined;
  configuredFilter: string | null | undefined;
  sink: LogSink;
}): Promise<WorkspaceRunner> {
  const pmRun = await detectPackageManagerRun(opts.workDir);
  const mode = opts.configured ?? "auto";

  if (mode === "script") return { kind: "script", pmRun };

  const turbo = await detectTurbo(opts.workDir);

  if (mode === "turbo" && !turbo.usable) {
    // Explicitly pinned to turbo: fail rather than silently degrade to a
    // command that won't build the app's dependencies.
    throw new Error(
      `Build runner is pinned to Turborepo, but it isn't usable in this repository: ${
        turbo.reason ?? "no turbo.json and no turbo dependency at the repository root"
      }. Add turbo.json + the turbo dev-dependency, or set the build runner to Auto.`,
    );
  }

  if (!turbo.usable) {
    if (turbo.reason) opts.sink.system(turbo.reason);
    return { kind: "script", pmRun };
  }

  const filter =
    opts.configuredFilter?.trim() || (await resolveTurboFilter(opts.workDir, opts.subdir));
  opts.sink.system(`turborepo detected: building with --filter=${filter}`);
  return { kind: "turbo", filter, pmRun };
}

/**
 * The build command for a workspace app.
 *
 * Turbo runs from the repo ROOT (not `cd`-ed into the app): that's what lets it
 * see the whole task graph and build the app's internal dependencies first.
 * The script runner keeps the previous `cd <subdir> && …` shape, where node
 * resolves the hoisted root node_modules.
 */
export function workspaceBuildCommand(opts: {
  runner: WorkspaceRunner;
  subdir: string;
  /** The app declares a `build` script. */
  hasBuildScript: boolean;
}): string | null {
  if (!opts.hasBuildScript) return null;
  if (opts.runner.kind === "turbo") {
    return `${opts.runner.pmRun} turbo run build --filter=${opts.runner.filter}`;
  }
  return `cd ${opts.subdir} && ${opts.runner.pmRun} build`;
}

/**
 * Fail a turbo build that matched no tasks.
 *
 * `turbo run build --filter=nope` exits 0 and prints "No tasks were executed".
 * Left alone that produces an image with no build output whose failure only
 * shows up as a 404 or a crash loop at runtime — the same silent-empty-image
 * class as the Staticfile/SPA incident `assertProviderCanServeSpa` guards. The
 * signature is in the build log, so catch it there.
 */
const NO_TASKS = /no tasks were executed|no packages matched|found no packages/i;

export function assertTurboRanTasks(opts: { runner: WorkspaceRunner; buildLog: string }): void {
  if (opts.runner.kind !== "turbo") return;
  if (!NO_TASKS.test(opts.buildLog)) return;
  throw new Error(
    `Turborepo matched no tasks for --filter=${opts.runner.filter}, so nothing was built and the ` +
      `image would ship without build output. Check that the root directory points at a workspace ` +
      `package with a "build" task, or set an explicit Turbo filter on the service's build settings.`,
  );
}
