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
 *
 * All outbound HTTP goes through `ghFetch` (packages/api/src/git/github-app.ts),
 * which routes every request through the shared SSRF-hardened egress policy
 * (packages/shared/src/egress-policy.ts) instead of calling `fetch` directly.
 */

import { db } from "@otterdeploy/db";
import { gitInstallation } from "@otterdeploy/db/schema";
import { gitRepo } from "@otterdeploy/db/schema";
import { hasPrefix, ID_PREFIX } from "@otterdeploy/shared/id";
import { Result, TaggedError } from "better-result";
import { eq } from "drizzle-orm";
import * as z from "zod";

import { getInstallationToken, ghFetch } from "../../git/github-app";

// Tagged so the oRPC handler can dispatch via `matchError`, same shape
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
        ? "GitHub rate-limited the installation: try again in a few minutes."
        : "GitHub anonymous rate limit exceeded: connect the GitHub App for higher limits, or wait a few minutes.",
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
   *  shas: we only need paths for the picker. */
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
  // Every gitRepo row's id is minted by `createId` with the `gitr_` prefix
  // (legacy `gitrepo_` included via hasPrefix), so a string without it cannot
  // match a row. The guard both skips the doomed query and narrows the raw
  // string to the branded column type without a cast.
  if (!hasPrefix(gitRepoId, ID_PREFIX.gitRepo)) return null;
  const [row] = await db
    .select({
      installationId: gitRepo.installationId,
      fullName: gitRepo.fullName,
      defaultBranch: gitRepo.defaultBranch,
      providerRepoId: gitRepo.providerRepoId,
    })
    .from(gitRepo)
    .where(eq(gitRepo.id, gitRepoId))
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
 * Minimal response shape shared by both the real DOM `Response` and
 * `ghFetch`'s egress-policy-wrapped return value. Just enough for the
 * rate-limit checks below, so callers on either side of the SSRF-hardened
 * `ghFetch` migration can use these helpers unchanged.
 */
interface RateLimitResponseLike {
  status: number;
  headers: { get(name: string): string | null };
}

/**
 * Detect a GitHub rate-limit response. The strongest signal is the
 * `X-RateLimit-Remaining: 0` header on a 403; we fall back to a body
 * substring match for older edge cases.
 */
export function isRateLimited(res: RateLimitResponseLike, body: string): boolean {
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get("X-RateLimit-Remaining");
    if (remaining === "0") return true;
    if (body.toLowerCase().includes("api rate limit exceeded")) return true;
    if (body.toLowerCase().includes("secondary rate limit")) return true;
  }
  return false;
}

export function rateLimitReset(res: RateLimitResponseLike): number | null {
  const v = res.headers.get("X-RateLimit-Reset");
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/** Only the fields the snapshot derivation reads; deliberately tolerant of
 *  whatever else GitHub sends (sha, mode, size, url, unknown `type` values). */
const ghTreeResponseSchema = z.object({
  tree: z.array(z.object({ path: z.string(), type: z.string() })).optional(),
});

/**
 * One-shot fetch of the entire repo tree. Recursive flag returns every
 * path in a single response (up to 100k entries; GitHub flags `truncated`
 * past that: we accept the lossy result).
 */
async function fetchFullTree(
  binding: RepoBinding,
): Promise<Result<TreeSnapshot, InspectRepoUpstreamError | InspectRepoRateLimitedError>> {
  const url = new URL(
    `https://api.github.com/repos/${binding.owner}/${binding.repo}/git/trees/${binding.defaultBranch}`,
  );
  url.searchParams.set("recursive", "1");
  const headers = await ghHeaders(binding.installationGithubId);
  const res = await ghFetch(url.toString(), { headers });
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
  const json = Result.try((): unknown => JSON.parse(body));
  const parsed = ghTreeResponseSchema.safeParse(json.isOk() ? json.value : null);
  if (!parsed.success) {
    return Result.err(new InspectRepoUpstreamError(502, "Could not parse GitHub response"));
  }
  const entries = parsed.data.tree ?? [];
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
  /** Workspace package name; the identity `deriveWatchPatterns` walks the
   *  dependency graph by (and the value turbo's `--filter` takes). */
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
  scripts?: Record<string, string>;
}

/** The subset of package.json the inspector reads. Unknown keys are dropped;
 *  a file that is not shaped like a package.json parses to null below, the
 *  same "no package.json" degrade path a fetch failure takes. */
const pkgJsonSchema: z.ZodType<PkgJson> = z.object({
  name: z.string().optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  workspaces: z
    .union([z.array(z.string()), z.object({ packages: z.array(z.string()).optional() })])
    .optional(),
  scripts: z.record(z.string(), z.string()).optional(),
});

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
  const res = await ghFetch(url.toString(), { headers });
  if (!res.ok) {
    pkgCache.set(key, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
    return null;
  }
  const text = await res.text();
  const json = Result.try((): unknown => JSON.parse(text));
  const checked = pkgJsonSchema.safeParse(json.isOk() ? json.value : null);
  const parsed = checked.success ? checked.data : null;
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
  const res = await ghFetch(url.toString(), { headers });
  if (!res.ok) return null;
  return await res.text();
}

/**
 * Trim GitHub's JSON error body to its `message` field when possible.
 * The picker shows this string verbatim. Keeps the rate-limit body off
 * the screen if we somehow miss the typed detection above.
 */
export function humanizeUpstreamBody(body: string, status: number): string {
  const json = Result.try((): unknown => JSON.parse(body));
  const parsed = json.isOk() ? json.value : null;
  const message =
    typeof parsed === "object" && parsed !== null && "message" in parsed ? parsed.message : null;
  if (typeof message === "string" && message.length > 0) return message;
  return body.slice(0, 200) || `GitHub returned ${status}`;
}
