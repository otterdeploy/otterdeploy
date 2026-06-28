/**
 * Inspect a bound git repo for the wizard's Root Directory picker.
 *
 * The expensive thing is GitHub's API — anonymous calls cap at 60/hr per
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

import {
  collectWorkspaceGlobs,
  COMMITTED_ENV_FILES,
  detectFrameworkForPath,
  detectMonorepoFromPaths,
  ENV_TEMPLATE_FILES,
  expandWorkspacePackages,
  listChildren,
  parseEnvKeys,
} from "./inspect-derive";
import {
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
  monorepo: MonorepoKind;
  monorepoPackages: string[];
}

export async function inspectRepoTree(args: {
  gitRepoId: string;
  path: string;
}): Promise<
  Result<
    InspectResult,
    InspectRepoNotFoundError | InspectRepoUpstreamError | InspectRepoRateLimitedError
  >
> {
  const binding = await resolveRepoBinding(args.gitRepoId);
  if (!binding) return Result.err(new InspectRepoNotFoundError());

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

  let monorepo: MonorepoKind = null;
  let monorepoPackages: string[] = [];
  if (path === "") {
    const rootPkg =
      snap.value.pathTypes.get("package.json") === "file"
        ? await fetchPackageJson(binding, "package.json", args.gitRepoId)
        : null;
    monorepo = detectMonorepoFromPaths(snap.value.paths, rootPkg);
    if (monorepo) {
      monorepoPackages = expandWorkspacePackages(snap.value, collectWorkspaceGlobs(rootPkg));
    }
  }

  return Result.ok({
    fullName: `${binding.owner}/${binding.repo}`,
    path,
    entries,
    framework,
    monorepo,
    monorepoPackages,
  });
}

export interface EnvInspection {
  /** A real env file is committed to the repo — a security red flag. */
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
export async function inspectEnvFiles(
  gitRepoId: string,
  path: string,
): Promise<
  Result<
    EnvInspection,
    InspectRepoNotFoundError | InspectRepoUpstreamError | InspectRepoRateLimitedError
  >
> {
  const binding = await resolveRepoBinding(gitRepoId);
  if (!binding) return Result.err(new InspectRepoNotFoundError());

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

/** Cap branch pagination — 5 pages × 100 covers any sane repo. */
const BRANCH_PAGE_CAP = 5;

/**
 * List a bound repo's branches for the new-resource wizard's branch picker.
 * Reuses inspectRepoTree's binding resolution, auth, and rate-limit handling.
 * The default branch is surfaced first so the Select can preselect it.
 */
export async function listRepoBranches(
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
    const res = await fetch(url, { headers });
    const body = await res.text();

    if (isRateLimited(res, body)) {
      return Result.err(new InspectRepoRateLimitedError(rateLimitReset(res), authenticated));
    }
    if (!res.ok) {
      return Result.err(
        new InspectRepoUpstreamError(res.status, humanizeUpstreamBody(body, res.status)),
      );
    }

    const parsed = Result.try(() => JSON.parse(body) as unknown);
    if (parsed.isErr()) {
      return Result.err(new InspectRepoUpstreamError(502, "Could not parse GitHub response"));
    }
    const pageItems = parsed.value;
    if (!Array.isArray(pageItems)) break;
    for (const b of pageItems) {
      const name = (b as { name?: unknown })?.name;
      if (typeof name === "string") names.push(name);
    }
    if (pageItems.length < 100) break;
  }

  // Default branch first, then the rest, de-duped — and guarantee the
  // default is present even if the listing came back empty.
  const branches = Array.from(new Set([binding.defaultBranch, ...names]));
  return Result.ok({ branches, defaultBranch: binding.defaultBranch });
}
