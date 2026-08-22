/**
 * Where (and how) railpack builds from the checked-out tree.
 *
 * Split out of railpack.ts to keep that file within the size budget. The
 * decision this file owns — repo root vs. service subdir as the build context —
 * is the workspace question, and it is settled BEFORE the turbo runner is even
 * consulted: turbo is a task runner over a workspace, so it can change what the
 * build command is, never where the context is anchored.
 */

import type { BuildRailpackConfig } from "@otterdeploy/shared/build-config";

import { join } from "node:path";

import { rootIsWorkspace } from "./railpack-detect";

/** Vite's default output dir; overridable via `config.staticRoot` for
 *  frameworks that emit elsewhere (e.g. CRA's `build`). */
const DEFAULT_STATIC_ROOT = "dist";

/** Filename railpack writes its `--info-out` analysis to, inside the clone
 *  dir. Read by `detect-framework.ts` after `prepare`. */
export const RAILPACK_INFO_FILE = "railpack-info.json";

export interface BuildLayout {
  /** Service subdir (monorepo), or null when building from the repo root. */
  subdir: string | null;
  /** Repo root declares a package workspace: a subdir service builds from root. */
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
 * analyse and build from the repo ROOT. That's where the lockfile, the
 * workspace catalog, and the sibling `packages/*` the app depends on live.
 * Pointed at the subdir alone it misdetects the package manager (no lockfile /
 * `packageManager` field there → falls back to npm) and the buildx context is
 * missing every workspace dependency, so install dies (e.g. `npm error
 * Unsupported URL Type "catalog:"`). We keep the root as the context and target
 * the app via cd-wrapped build/start commands (see `resolveBuildCommands`).
 * Railpack's own recommended monorepo flow (https://railpack.com/languages/node).
 *
 * A subdir NOT inside a workspace (a self-contained app folder with its own
 * lockfile) keeps building from the subdir, exactly as before.
 *
 * `infoPath` is railpack's `--info-out` analysis (providers, runtime/framework,
 * resolved versions) written next to the plan; `detect-framework.ts` reads it
 * back from the build dir before the pipeline removes the work tree.
 */
export async function resolveBuildLayout(opts: {
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
  // sits under its subdir. Prepend it. Guard against a staticRoot that ALREADY
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
