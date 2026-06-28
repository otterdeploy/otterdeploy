/**
 * GitHub plumbing for the repo-inspection feature (see inspect.ts). Holds the
 * typed errors, the per-repo TTL caches, the one-shot recursive tree fetch, and
 * the path/framework/monorepo derivations that read from that snapshot without
 * extra HTTP. The public inspect/env/branch entry points live in inspect.ts.
 *
 * Auth model:
 *   - installation-backed gitRepo → mint a short-lived install token, use it as
 *     Bearer for Contents API calls. 5000 req/hr.
 *   - public-URL gitRepo (installationId is null) → anonymous request,
 *     60 req/hr per source IP.
 */

import { db } from "@otterdeploy/db";
import { gitInstallation } from "@otterdeploy/db/schema";
import { gitRepo } from "@otterdeploy/db/schema";
import { Result, TaggedError } from "better-result";
import { eq } from "drizzle-orm";

import { getInstallationToken } from "../../git/github-app";

// Tagged so the oRPC handler can dispatch via `matchError` — same shape
// as ProjectNotFoundError etc. in routers/project/errors.ts.
export class InspectRepoNotFoundError extends TaggedError("InspectRepoNotFoundError")<{
  message: string;
}>() {
  constructor() {
    super({ message: "Repo not found" });
  }
}

export class InspectRepoUpstreamError extends TaggedError("InspectRepoUpstreamError")<{
  message: string;
  status: number;
}>() {
  constructor(status: number, message: string) {
    super({ status, message });
  }
}

export class InspectRepoRateLimitedError extends TaggedError("InspectRepoRateLimitedError")<{
  message: string;
  resetsAt: number | null;
  authenticated: boolean;
}>() {
  constructor(resetsAt: number | null, authenticated: boolean) {
    super({
      resetsAt,
      authenticated,
      message: authenticated
        ? "GitHub rate-limited the installation — try again in a few minutes."
        : "GitHub anonymous rate limit exceeded — connect the GitHub App for higher limits, or wait a few minutes.",
    });
  }
}

export type MonorepoKind =
  | "turbo"
  | "nx"
  | "pnpm-workspace"
  | "yarn-workspace"
  | "npm-workspace"
  | "lerna"
  | null;

export interface InspectEntry {
  name: string;
  type: "dir" | "file";
}

export interface RepoBinding {
  owner: string;
  repo: string;
  installationGithubId: string | null;
  defaultBranch: string;
}

/** TTL on cached results. Long enough to soak up wizard navigation;
 *  short enough that a fresh push surfaces within a few minutes. */
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface TreeSnapshot {
  /** Every blob path in the repo, sorted. Includes `name` only, not
   *  shas — we only need paths for the picker. */
  paths: string[];
  /** Same paths but with the tree (directory) entries flagged so
   *  we don't reissue contents calls to figure out file vs. dir. */
  pathTypes: Map<string, "dir" | "file">;
  expiresAt: number;
}

const treeCache = new Map<string, TreeSnapshot>();
const pkgCache = new Map<string, { value: PkgJson | null; expiresAt: number }>();

function cacheKeyForRepo(gitRepoId: string): string {
  return gitRepoId;
}

export async function resolveRepoBinding(gitRepoId: string): Promise<RepoBinding | null> {
  const [row] = await db
    .select({
      installationId: gitRepo.installationId,
      fullName: gitRepo.fullName,
      defaultBranch: gitRepo.defaultBranch,
      providerRepoId: gitRepo.providerRepoId,
    })
    .from(gitRepo)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .where(eq(gitRepo.id, gitRepoId as any))
    .limit(1);
  if (!row) return null;

  const parts = row.fullName.split("/");
  if (parts.length !== 2) return null;
  const owner = parts[0];
  const repo = parts[1];
  if (!owner || !repo) return null;

  let installationGithubId: string | null = null;
  if (row.installationId) {
    const [inst] = await db
      .select({ installationId: gitInstallation.installationId })
      .from(gitInstallation)
      .where(eq(gitInstallation.id, row.installationId))
      .limit(1);
    installationGithubId = inst?.installationId ?? null;
  }

  return {
    owner,
    repo,
    installationGithubId,
    defaultBranch: row.defaultBranch ?? "main",
  };
}

export async function ghHeaders(
  installationGithubId: string | null,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "otterdeploy",
  };
  if (installationGithubId) {
    const tok = await getInstallationToken(installationGithubId);
    headers.Authorization = `Bearer ${tok.token}`;
  }
  return headers;
}

/**
 * Detect a GitHub rate-limit response. The strongest signal is the
 * `X-RateLimit-Remaining: 0` header on a 403; we fall back to a body
 * substring match for older edge cases.
 */
export function isRateLimited(res: Response, body: string): boolean {
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get("X-RateLimit-Remaining");
    if (remaining === "0") return true;
    if (body.toLowerCase().includes("api rate limit exceeded")) return true;
    if (body.toLowerCase().includes("secondary rate limit")) return true;
  }
  return false;
}

export function rateLimitReset(res: Response): number | null {
  const v = res.headers.get("X-RateLimit-Reset");
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

interface GhTreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
  sha: string;
}

/**
 * One-shot fetch of the entire repo tree. Recursive flag returns every
 * path in a single response (up to 100k entries; GitHub flags `truncated`
 * past that — we accept the lossy result).
 */
async function fetchFullTree(
  binding: RepoBinding,
): Promise<Result<TreeSnapshot, InspectRepoUpstreamError | InspectRepoRateLimitedError>> {
  const url = new URL(
    `https://api.github.com/repos/${binding.owner}/${binding.repo}/git/trees/${binding.defaultBranch}`,
  );
  url.searchParams.set("recursive", "1");
  const headers = await ghHeaders(binding.installationGithubId);
  const res = await fetch(url, { headers });
  const body = await res.text();
  if (!res.ok) {
    if (isRateLimited(res, body)) {
      return Result.err(
        new InspectRepoRateLimitedError(rateLimitReset(res), binding.installationGithubId != null),
      );
    }
    return Result.err(
      new InspectRepoUpstreamError(res.status, humanizeUpstreamBody(body, res.status)),
    );
  }
  let parsed: { tree?: GhTreeEntry[]; truncated?: boolean };
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    return Result.err(new InspectRepoUpstreamError(502, "Could not parse GitHub response"));
  }
  const entries = parsed.tree ?? [];
  const pathTypes = new Map<string, "dir" | "file">();
  for (const e of entries) {
    if (e.type === "tree") pathTypes.set(e.path, "dir");
    else if (e.type === "blob") pathTypes.set(e.path, "file");
  }
  return Result.ok({
    paths: entries.map((e) => e.path).sort((a, b) => a.localeCompare(b)),
    pathTypes,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

export async function getTreeSnapshot(
  binding: RepoBinding,
  gitRepoId: string,
): Promise<Result<TreeSnapshot, InspectRepoUpstreamError | InspectRepoRateLimitedError>> {
  const key = cacheKeyForRepo(gitRepoId);
  const cached = treeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return Result.ok(cached);

  const result = await fetchFullTree(binding);
  if (result.isErr()) return result;
  treeCache.set(key, result.value);
  return result;
}

export interface PkgJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
  scripts?: Record<string, string>;
}

export async function fetchPackageJson(
  binding: RepoBinding,
  path: string,
  gitRepoId: string,
): Promise<PkgJson | null> {
  const key = `${gitRepoId}:${path}`;
  const cached = pkgCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const url = new URL(
    `https://api.github.com/repos/${binding.owner}/${binding.repo}/contents/${path}`,
  );
  url.searchParams.set("ref", binding.defaultBranch);
  const headers = await ghHeaders(binding.installationGithubId);
  headers.Accept = "application/vnd.github.raw+json";
  const res = await fetch(url, { headers });
  if (!res.ok) {
    pkgCache.set(key, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
    return null;
  }
  let parsed: PkgJson | null = null;
  try {
    parsed = JSON.parse(await res.text()) as PkgJson;
  } catch {
    parsed = null;
  }
  pkgCache.set(key, { value: parsed, expiresAt: Date.now() + CACHE_TTL_MS });
  return parsed;
}

/** Raw text read of a single file (no JSON parse), mirroring fetchPackageJson. */
export async function fetchTextFile(binding: RepoBinding, path: string): Promise<string | null> {
  const url = new URL(
    `https://api.github.com/repos/${binding.owner}/${binding.repo}/contents/${path}`,
  );
  url.searchParams.set("ref", binding.defaultBranch);
  const headers = await ghHeaders(binding.installationGithubId);
  headers.Accept = "application/vnd.github.raw+json";
  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  return await res.text();
}

/**
 * Trim GitHub's JSON error body to its `message` field when possible —
 * the picker shows this string verbatim. Keeps the rate-limit body off
 * the screen if we somehow miss the typed detection above.
 */
export function humanizeUpstreamBody(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { message?: string };
    if (typeof parsed.message === "string" && parsed.message.length > 0) {
      return parsed.message;
    }
  } catch {
    /* not json */
  }
  return body.slice(0, 200) || `GitHub returned ${status}`;
}
