/**
 * `turbo prune` support: build a workspace app from a pruned copy of the
 * monorepo instead of the whole clone.
 *
 * What this actually buys, measured against otterdeploy's own repo building
 * `apps/server` (2026-08-21):
 *
 *   context   48.9 MB / 3061 files  →  23 MB / 1150 files
 *   install   17 workspace packages →  10 (the reachable set)
 *   prune      ~0.3s with turbo already on PATH
 *
 * The install narrowing is the real prize: a backend service in a repo that
 * also holds frontend apps stops installing vite/react/tailwind it will never
 * import. Note what it is NOT for — railpack already copies only the workspace
 * manifests + lockfile into its install step and defers source to a later
 * layer, so `bun install` already survives a source-only change. Pruning does
 * not improve that; it makes the install itself smaller.
 *
 * ── Why this is opt-in, and guarded ──────────────────────────────────────
 *
 * `turbo prune` keeps the root `package.json`, the lockfile and `turbo.json`,
 * and drops EVERY other root-level file. On otterdeploy that is harmless (its
 * shared tsconfig lives in a real workspace package, `@otterdeploy/config`),
 * but the far more common monorepo layout puts shared config at the root and
 * has each package do `"extends": "../../tsconfig.json"`. Pruning such a repo
 * produces a tree whose build fails on a file that exists in git — the worst
 * kind of failure, because the repo looks fine.
 *
 * So: opt-in, and `unsafeDroppedRootFiles` refuses to prune when the drop would
 * remove something a build plausibly reads. A cache/size optimisation must
 * never change whether the build succeeds.
 *
 * Turbo itself is treated as optional: when the binary isn't on the builder's
 * PATH this degrades to an unpruned build with a log line rather than failing.
 * The builder image does ship it (apps/server/Dockerfile pins a SHA-verified
 * `@turbo/linux-*` binary — both are statically linked, so the musl base needs
 * no libc6-compat), but a self-hosted or older image may not, and a missing
 * tool must never be the reason a deploy fails.
 */

import { Result } from "better-result";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import type { LogSink } from "./log-stream";

import { runProcess } from "./run-process";

/**
 * Root-level names that a build legitimately reads and that `turbo prune`
 * does not carry over. If pruning would drop one of these, we don't prune.
 *
 * Deliberately generous: the cost of a false positive is one unpruned build
 * (i.e. exactly today's behaviour), while the cost of a false negative is a
 * broken build that worked yesterday.
 */
const BUILD_RELEVANT_ROOT = [
  /\.config\.(js|cjs|mjs|ts|cts|mts|json)$/i,
  /^\.npmrc$/i,
  /^\.yarnrc(\.yml)?$/i,
  /^\.nvmrc$/i,
  /^\.node-version$/i,
  /^\.tool-versions$/i,
  /^\.env(\..+)?$/i,
  /^patches$/i,
  /^\.yarn$/i,
  /^\.pnp\.(c?js)$/i,
  /^Makefile$/i,
  /^\.python-version$/i,
  /^requirements.*\.txt$/i,
  /^go\.(mod|sum)$/i,
  /^Cargo\.(toml|lock)$/i,
];

/** Names that are always safe to lose: VCS/editor/CI metadata and the docs a
 *  build never reads. Checked first so they never trip the guard above. */
const IGNORABLE_ROOT = [
  /^\.git$/i,
  /^\.github$/i,
  /^\.gitignore$/i,
  /^\.gitattributes$/i,
  /^\.dockerignore$/i,
  /^\.vscode$/i,
  /^\.idea$/i,
  /^\.claude$/i,
  /^LICENSE/i,
  /^README/i,
  /^CHANGELOG/i,
  /^\.DS_Store$/i,
  /^node_modules$/i,
];

/** Root tsconfigs get their own treatment: see `rootTsconfigIsReferenced`. */
const ROOT_TSCONFIG = /^tsconfig.*\.json$/i;

/**
 * Root entries present in the clone but missing from the pruned tree that a
 * build might actually need. Empty ⇒ pruning this repo is safe.
 *
 * `referencedTsconfig` answers whether a root tsconfig is actually reachable
 * from a surviving package's `extends` chain. Without that question a root
 * `tsconfig.json` — which nearly every TS monorepo has, referenced or not —
 * would block pruning everywhere and make the feature inert.
 */
export function unsafeDroppedRootFiles(
  original: string[],
  pruned: string[],
  referencedTsconfig = true,
): string[] {
  const kept = new Set(pruned);
  return original
    .filter((name) => !kept.has(name))
    .filter((name) => !IGNORABLE_ROOT.some((re) => re.test(name)))
    .filter((name) => {
      if (ROOT_TSCONFIG.test(name)) return referencedTsconfig;
      return BUILD_RELEVANT_ROOT.some((re) => re.test(name));
    });
}

/**
 * Does any surviving package reach up out of its own directory to extend a
 * tsconfig? `"extends": "../../tsconfig.json"` means the root file is load-
 * bearing and pruning would break `tsc`; `"extends": "@acme/config/base.json"`
 * resolves through node_modules to a workspace package prune keeps, so the
 * root file is inert and safe to drop.
 *
 * Errs toward "referenced" on any read failure: an unreadable tsconfig is a
 * reason to skip the optimisation, not to gamble on it.
 */
export async function rootTsconfigIsReferenced(prunedDir: string): Promise<boolean> {
  const found = await Result.tryPromise({
    try: () =>
      Array.fromAsync(
        new Bun.Glob("{apps,packages}/*/tsconfig*.json").scan({ cwd: prunedDir, onlyFiles: true }),
      ),
    catch: (cause: unknown) => cause,
  });
  if (found.isErr()) return true;

  for (const rel of found.value) {
    const text = await Result.tryPromise({
      try: () => Bun.file(join(prunedDir, rel)).text(),
      catch: (cause: unknown) => cause,
    });
    if (text.isErr()) return true;
    const parsed = Result.try((): unknown => JSON.parse(stripJsonComments(text.value)));
    if (parsed.isErr()) return true;
    for (const target of extendsTargets(parsed.value)) {
      // Only a relative path can escape the package; a bare specifier resolves
      // through node_modules to a package prune already kept.
      if (target.startsWith(".") && target.includes("../")) return true;
    }
  }
  return false;
}

/** `extends` is a string or (TS 5+) an array of them. */
function extendsTargets(config: unknown): string[] {
  if (typeof config !== "object" || config === null || !("extends" in config)) return [];
  const value = config.extends;
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string");
  return [];
}

/** tsconfig.json permits comments and trailing commas; JSON.parse does not.
 *  Strips both well enough to read one `extends` field. */
function stripJsonComments(text: string): string {
  return text
    .replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, comment) => (comment ? "" : m))
    .replace(/,(\s*[}\]])/g, "$1");
}

/** Directory name for the pruned tree, a sibling of the clone so it lands on
 *  the same filesystem (the pipeline's cleanup sweeps the parent). */
const PRUNE_DIR = ".otterdeploy-prune";

/** Is the turbo CLI available to the builder process? Cached per process:
 *  the answer can't change without a redeploy of the builder itself. */
let turboOnPath: boolean | null = null;

async function hasTurboCli(sink: LogSink): Promise<boolean> {
  if (turboOnPath !== null) return turboOnPath;
  const probe = await runProcess({
    cmd: "turbo",
    args: ["--version"],
    sink,
    echo: false,
  }).catch(() => null);
  turboOnPath = probe !== null && probe.exitCode === 0;
  return turboOnPath;
}

/**
 * Produce a pruned copy of the workspace for `filter`, or null to build the
 * clone as-is.
 *
 * Returns null (never throws) for every "can't or shouldn't prune" case:
 * turbo missing, prune failing (an unparseable lockfile is the usual cause),
 * or the safety guard tripping. Callers just build the original tree.
 */
export async function pruneWorkspace(opts: {
  workDir: string;
  /** Turbo filter for the app being built (its package name). */
  filter: string;
  sink: LogSink;
}): Promise<string | null> {
  if (!(await hasTurboCli(opts.sink))) {
    opts.sink.system(
      "turbo prune requested but the turbo CLI isn't available on the build host; building the full workspace",
    );
    return null;
  }

  const outDir = join(opts.workDir, PRUNE_DIR);
  // A retry of the same deployment could find a partial tree here.
  await Result.tryPromise({
    try: () => rm(outDir, { recursive: true, force: true }),
    catch: (cause: unknown) => cause,
  });

  const pruned = await runProcess({
    cmd: "turbo",
    args: ["prune", opts.filter, `--out-dir=${outDir}`],
    cwd: opts.workDir,
    sink: opts.sink,
    echo: false,
  }).catch(() => null);

  if (!pruned || pruned.exitCode !== 0) {
    opts.sink.system(
      `turbo prune failed (${pruned ? `exit ${pruned.exitCode}` : "could not run"}); building the full workspace. ` +
        "A lockfile turbo can't parse is the usual cause.",
    );
    return null;
  }

  const guard = await guardPrunedTree(opts.workDir, outDir);
  if (guard.length > 0) {
    opts.sink.system(
      `not building from the pruned workspace: turbo prune drops ${guard.join(", ")} from the ` +
        "repository root, which the build may need. Building the full workspace instead " +
        "(move shared config into a workspace package to make this repo prunable).",
    );
    return null;
  }

  opts.sink.system(`building from a pruned workspace (turbo prune --filter=${opts.filter})`);
  return outDir;
}

/** Compare root entries of the clone and the pruned tree. Any read failure
 *  yields a non-empty result, i.e. "don't prune": we only prune when we could
 *  positively confirm it's safe. */
async function guardPrunedTree(workDir: string, outDir: string): Promise<string[]> {
  const original = await Result.tryPromise({
    try: () => readdir(workDir),
    catch: (cause: unknown) => cause,
  });
  const pruned = await Result.tryPromise({
    try: () => readdir(outDir),
    catch: (cause: unknown) => cause,
  });
  if (original.isErr() || pruned.isErr()) return ["(could not compare the pruned tree)"];
  // The prune output dir itself lives inside the clone; never count it.
  const originalNames = original.value.filter((n) => n !== PRUNE_DIR);
  const tsconfigMatters = await rootTsconfigIsReferenced(outDir);
  return unsafeDroppedRootFiles(originalNames, pruned.value, tsconfigMatters);
}
