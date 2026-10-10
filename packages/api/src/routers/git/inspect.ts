/**
 * Inspect a bound git repo for the wizard's Root Directory picker.
 *
 * The expensive thing is GitHub's API. Anonymous calls cap at 60/hr per
 * source IP, which gets eaten in seconds by per-folder navigation. Two
 * defences (both implemented in inspect-github.ts):
 *
 *   1. One snapshot per repo. We call `git/trees/{branch}?recursive=1`
 *      ONCE to get every path in the repo, then derive folder listings,
 *      monorepo signals, and package paths by filtering that snapshot.
 *      Subsequent navigations don't hit GitHub at all.
 *
 *   2. Server-side TTL cache. The snapshot lives in-process keyed by
 *      gitRepoId; package.json reads (for framework detection) live in
 *      a sibling cache keyed by `gitRepoId:path`.
 *
 * Rate-limit responses are surfaced as a typed `InspectRepoRateLimitedError`
 * so the UI can show a useful message ("connect the GitHub App for higher
 * limits") instead of dumping raw JSON.
 */

import { type FrameworkKind } from "@otterdeploy/shared/framework";
import { Result } from "better-result";

import { ghFetch } from "../../git/github-app";
import {
  collectWorkspaceGlobs,
  COMMITTED_ENV_FILES,
  detectDockerfile,
  type DockerfileDetection,
  detectFrameworkForPath,
  detectMonorepoFromPaths,
  ENV_TEMPLATE_FILES,
  expandWorkspacePackages,
  listChildren,
  parseEnvKeys,
} from "./inspect-derive";
import {
  atRef,
  fetchPackageJson,
  fetchTextFile,
  getTreeSnapshot,
  ghHeaders,
  type InspectEntry,
  InspectRepoNotFoundError,
  InspectRepoRateLimitedError,
  InspectRepoUpstreamError,
  isRateLimited,
  type MonorepoKind,
  rateLimitReset,
  resolveRepoBinding,
  humanizeUpstreamBody,
} from "./inspect-github";
import { type InspectRepoNotConfiguredError, withInstallationToken } from "./inspect-token";
import { deriveWatchPatterns } from "./watch-patterns";

// Canonical type lives in @otterdeploy/shared/framework (single source of
// truth shared with the DB column, the resource contract, the builder's
// detector, and the web logo map). Re-exported here for existing callers.
export type { FrameworkKind };
export type { InspectEntry, MonorepoKind } from "./inspect-github";

export interface InspectResult {
  /** owner/repo of the bound repository. */
  fullName: string;
  path: string;
  entries: InspectEntry[];
  framework: FrameworkKind;
  /** The Dockerfile at this path, which a git service builds with by default
   *  (railpack is the fallback when there is none). */
  dockerfile: DockerfileDetection | null;
  monorepo: MonorepoKind;
  monorepoPackages: string[];
  /** Suggested `buildConfig.watchPatterns` for a workspace app at this path.
   *  Empty at the repo root or outside a workspace. */
  watchPatterns: string[];
}

/** Every way a GitHub-backed inspection can fail, as the router maps them. */
type InspectFailure =
  | InspectRepoNotFoundError
  | InspectRepoNotConfiguredError
  | InspectRepoUpstreamError
  | InspectRepoRateLimitedError;

export function inspectRepoTree(args: {
  gitRepoId: string;
  path: string;
  /** Branch to read; blank = the repo's default branch. */
  ref?: string;
}): Promise<Result<InspectResult, InspectFailure>> {
  return withInstallationToken(() => inspectRepoTreeWithToken(args));
}

async function inspectRepoTreeWithToken(args: {
  gitRepoId: string;
  path: string;
  /** Branch to read; blank = the repo's default branch. */
  ref?: string;
}): Promise<
  Result<
    InspectResult,
    InspectRepoNotFoundError | InspectRepoUpstreamError | InspectRepoRateLimitedError
  >
> {
  const bound = await resolveRepoBinding(args.gitRepoId);
  if (!bound) return Result.err(new InspectRepoNotFoundError());
  // Detection must describe the tree that will be built: the branch the user
  // picked, not whatever the repo's default happens to be.
  const binding = atRef(bound, args.ref);

  const path = args.path.replace(/^\/+|\/+$/g, "");

  const snap = await getTreeSnapshot(binding, args.gitRepoId);
  if (snap.isErr()) return Result.err(snap.error);

  // Reject paths that don't exist as a directory in the snapshot.
  // Special-case root (empty path) which is always implicit.
  if (path !== "" && snap.value.pathTypes.get(path) !== "dir") {
    return Result.err(new InspectRepoNotFoundError());
  }

  const entries = listChildren(snap.value, path);
  const framework = await detectFrameworkForPath(binding, snap.value, path, args.gitRepoId);
  const dockerfile = await detectDockerfile(binding, snap.value, path, args.gitRepoId);

  // The monorepo signals describe the REPO, so they're derived once at the
  // root. `watchPatterns` describe one app inside it, so they're derived for a
  // non-root path, from the workspace list the root scan produced.
  const rootPkg =
    snap.value.pathTypes.get("package.json") === "file"
      ? await fetchPackageJson(binding, "package.json", args.gitRepoId)
      : null;
  const monorepoKind = detectMonorepoFromPaths(snap.value.paths, rootPkg);
  const workspacePackages = monorepoKind
    ? expandWorkspacePackages(snap.value, collectWorkspaceGlobs(rootPkg))
    : [];

  const monorepo: MonorepoKind = path === "" ? monorepoKind : null;
  const monorepoPackages = path === "" ? workspacePackages : [];

  // Suggested watch patterns for this app: its own dir, the dirs of every
  // workspace package it depends on (transitively), and the root build files.
  // Only meaningful inside a workspace, and only for a specific app.
  const watchPatterns =
    path !== "" && monorepoKind
      ? await deriveWatchPatterns({
          snapshot: snap.value,
          subdir: path,
          workspacePackages,
          readPackageJson: (pkgPath) => fetchPackageJson(binding, pkgPath, args.gitRepoId),
        })
      : [];

  return Result.ok({
    fullName: `${binding.owner}/${binding.repo}`,
    path,
    entries,
    framework,
    dockerfile,
    monorepo,
    monorepoPackages,
    watchPatterns,
  });
}

export interface EnvInspection {
  /** A real env file is committed to the repo, a security red flag. */
  committedEnv: string | null;
  /** Which template file the keys came from, if any. */
  templateFile: string | null;
  /** Variable names harvested from the template (values intentionally dropped). */
  keys: string[];
}

/**
 * Inspect a bound repo for env files at the given root: detect a committed
 * `.env` (security flaw) and harvest keys from a `.env.example`/`.env.sample`
 * template so the wizard can prefill the Variables step.
 */
export function inspectEnvFiles(
  gitRepoId: string,
  path: string,
  ref?: string,
): Promise<Result<EnvInspection, InspectFailure>> {
  return withInstallationToken(() => inspectEnvFilesWithToken(gitRepoId, path, ref));
}

async function inspectEnvFilesWithToken(
  gitRepoId: string,
  path: string,
  ref?: string,
): Promise<
  Result<
    EnvInspection,
    InspectRepoNotFoundError | InspectRepoUpstreamError | InspectRepoRateLimitedError
  >
> {
  const bound = await resolveRepoBinding(gitRepoId);
  if (!bound) return Result.err(new InspectRepoNotFoundError());
  const binding = atRef(bound, ref);

  const snapshot = await getTreeSnapshot(binding, gitRepoId);
  if (snapshot.isErr()) return Result.err(snapshot.error);

  const base = path ? `${path.replace(/\/+$/, "")}/` : "";
  const isFile = (name: string) => snapshot.value.pathTypes.get(`${base}${name}`) === "file";

  const committedEnv = COMMITTED_ENV_FILES.find(isFile) ?? null;
  const templateFile = ENV_TEMPLATE_FILES.find(isFile) ?? null;

  let keys: string[] = [];
  if (templateFile) {
    const content = await fetchTextFile(binding, `${base}${templateFile}`);
    if (content) keys = parseEnvKeys(content);
  }

  return Result.ok({ committedEnv, templateFile, keys });
}

/** Cap branch pagination: 5 pages × 100 covers any sane repo. */
const BRANCH_PAGE_CAP = 5;

/**
 * List a bound repo's branches for the new-resource wizard's branch picker.
 * Reuses inspectRepoTree's binding resolution, auth, and rate-limit handling.
 * The default branch is surfaced first so the Select can preselect it.
 */
export function listRepoBranches(
  gitRepoId: string,
): Promise<Result<{ branches: string[]; defaultBranch: string }, InspectFailure>> {
  return withInstallationToken(() => listRepoBranchesWithToken(gitRepoId));
}

async function listRepoBranchesWithToken(
  gitRepoId: string,
): Promise<
  Result<
    { branches: string[]; defaultBranch: string },
    InspectRepoNotFoundError | InspectRepoUpstreamError | InspectRepoRateLimitedError
  >
> {
  const binding = await resolveRepoBinding(gitRepoId);
  if (!binding) return Result.err(new InspectRepoNotFoundError());

  const headers = await ghHeaders(binding.installationGithubId);
  const authenticated = binding.installationGithubId != null;
  const names: string[] = [];

  for (let page = 1; page <= BRANCH_PAGE_CAP; page++) {
    const url = `https://api.github.com/repos/${binding.owner}/${binding.repo}/branches?per_page=100&page=${page}`;
    const res = await ghFetch(url, { headers });
    const body = await res.text();

    if (isRateLimited(res, body)) {
      return Result.err(new InspectRepoRateLimitedError(rateLimitReset(res), authenticated));
    }
    if (!res.ok) {
      return Result.err(
        new InspectRepoUpstreamError(res.status, humanizeUpstreamBody(body, res.status)),
      );
    }

    const parsed = Result.try((): unknown => JSON.parse(body));
    if (parsed.isErr()) {
      return Result.err(new InspectRepoUpstreamError(502, "Could not parse GitHub response"));
    }
    const pageItems = parsed.value;
    if (!Array.isArray(pageItems)) break;
    const items: unknown[] = pageItems;
    for (const b of items) {
      if (typeof b !== "object" || b === null || !("name" in b)) continue;
      const { name } = b;
      if (typeof name === "string") names.push(name);
    }
    if (pageItems.length < 100) break;
  }

  // Default branch first, then the rest, de-duped, and guarantee the
  // default is present even if the listing came back empty.
  const branches = Array.from(new Set([binding.defaultBranch, ...names]));
  return Result.ok({ branches, defaultBranch: binding.defaultBranch });
}
