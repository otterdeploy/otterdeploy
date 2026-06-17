/**
 * Inspect a bound git repo for the wizard's Root Directory picker.
 *
 * The expensive thing is GitHub's API — anonymous calls cap at 60/hr per
 * source IP, which gets eaten in seconds by per-folder navigation. Two
 * defences:
 *
 *   1. One snapshot per repo. We call `git/trees/{branch}?recursive=1`
 *      ONCE to get every path in the repo, then derive folder listings,
 *      monorepo signals, and package paths by filtering that snapshot.
 *      Subsequent navigations don't hit GitHub at all.
 *
 *   2. Server-side TTL cache. The snapshot lives in-process keyed by
 *      gitRepoId; package.json reads (for framework detection) live in
 *      a sibling cache keyed by `gitRepoId:path`. Both expire after
 *      `CACHE_TTL_MS` so a repo can be re-inspected after a push.
 *
 * Rate-limit responses are detected via `X-RateLimit-Remaining: 0` or
 * the GitHub error body and surfaced as a typed `InspectRepoRateLimited
 * Error` so the UI can show a useful message ("connect the GitHub App
 * for higher limits") instead of dumping raw JSON.
 *
 * Auth model:
 *   - installation-backed gitRepo → mint a short-lived install token,
 *     use it as Bearer for Contents API calls. 5000 req/hr.
 *   - public-URL gitRepo (installationId is null) → anonymous request,
 *     60 req/hr per source IP.
 */

import { gitInstallation } from "@otterdeploy/db/schema";

import {
  detectFrameworkFromPkg,
  type FrameworkKind,
} from "@otterdeploy/shared/framework";

import { Result, TaggedError } from "better-result";

import { db } from "@otterdeploy/db";
import { gitRepo } from "@otterdeploy/db/schema";
import { eq } from "drizzle-orm";

import { getInstallationToken } from "../../git/github-app";

// Tagged so the oRPC handler can dispatch via `matchError` — same shape
// as ProjectNotFoundError etc. in routers/project/errors.ts.
class InspectRepoNotFoundError extends TaggedError(
  "InspectRepoNotFoundError",
)<{ message: string }>() {
  constructor() {
    super({ message: "Repo not found" });
  }
}

class InspectRepoUpstreamError extends TaggedError(
  "InspectRepoUpstreamError",
)<{ message: string; status: number }>() {
  constructor(status: number, message: string) {
    super({ status, message });
  }
}

class InspectRepoRateLimitedError extends TaggedError(
  "InspectRepoRateLimitedError",
)<{
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

// Canonical type lives in @otterdeploy/shared/framework (single source of
// truth shared with the DB column, the resource contract, the builder's
// detector, and the web logo map). Re-exported here for existing callers.
export type { FrameworkKind };

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

export interface InspectResult {
  /** owner/repo of the bound repository. */
  fullName: string;
  path: string;
  entries: InspectEntry[];
  framework: FrameworkKind;
  monorepo: MonorepoKind;
  monorepoPackages: string[];
}

interface RepoBinding {
  owner: string;
  repo: string;
  installationGithubId: string | null;
  defaultBranch: string;
}

/** TTL on cached results. Long enough to soak up wizard navigation;
 *  short enough that a fresh push surfaces within a few minutes. */
const CACHE_TTL_MS = 5 * 60 * 1000;

interface TreeSnapshot {
  /** Every blob path in the repo, sorted. Includes `name` only, not
   *  shas — we only need paths for the picker. */
  paths: string[];
  /** Same paths but with the tree (directory) entries flagged so
   *  we don't reissue contents calls to figure out file vs. dir. */
  pathTypes: Map<string, "dir" | "file">;
  expiresAt: number;
}

const treeCache = new Map<string, TreeSnapshot>();
const pkgCache = new Map<
  string,
  { value: PkgJson | null; expiresAt: number }
>();

function cacheKeyForRepo(gitRepoId: string): string {
  return gitRepoId;
}

async function resolveRepoBinding(
  gitRepoId: string,
): Promise<RepoBinding | null> {
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

async function ghHeaders(
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
function isRateLimited(
  res: Response,
  body: string,
): boolean {
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get("X-RateLimit-Remaining");
    if (remaining === "0") return true;
    if (body.toLowerCase().includes("api rate limit exceeded")) return true;
    if (body.toLowerCase().includes("secondary rate limit")) return true;
  }
  return false;
}

function rateLimitReset(res: Response): number | null {
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
): Promise<
  Result<
    TreeSnapshot,
    | InspectRepoUpstreamError
    | InspectRepoRateLimitedError
  >
> {
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
        new InspectRepoRateLimitedError(
          rateLimitReset(res),
          binding.installationGithubId != null,
        ),
      );
    }
    return Result.err(
      new InspectRepoUpstreamError(
        res.status,
        humanizeUpstreamBody(body, res.status),
      ),
    );
  }
  let parsed: { tree?: GhTreeEntry[]; truncated?: boolean };
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    return Result.err(
      new InspectRepoUpstreamError(502, "Could not parse GitHub response"),
    );
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

async function getTreeSnapshot(
  binding: RepoBinding,
  gitRepoId: string,
): Promise<
  Result<
    TreeSnapshot,
    | InspectRepoUpstreamError
    | InspectRepoRateLimitedError
  >
> {
  const key = cacheKeyForRepo(gitRepoId);
  const cached = treeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return Result.ok(cached);

  const result = await fetchFullTree(binding);
  if (result.isErr()) return result;
  treeCache.set(key, result.value);
  return result;
}

interface PkgJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
  scripts?: Record<string, string>;
}

async function fetchPackageJson(
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

// Framework detection from a parsed package.json lives in
// @otterdeploy/shared/framework — the SAME heuristic the builder runs against
// the locally-cloned package.json at build time, so the wizard preview and the
// stored framework agree. `PkgJson` here is structurally compatible with the
// shared `PackageJsonLike` (it carries the dependency maps the detector reads).
const detectFromPkg = detectFrameworkFromPkg;

/** Detect monorepo signal from the cached path list — no extra HTTP. */
function detectMonorepoFromPaths(
  paths: string[],
  rootPkg: PkgJson | null,
): MonorepoKind {
  const rootFiles = new Set(paths.filter((p) => !p.includes("/")));
  if (rootFiles.has("turbo.json")) return "turbo";
  if (rootFiles.has("nx.json")) return "nx";
  if (
    rootFiles.has("pnpm-workspace.yaml") ||
    rootFiles.has("pnpm-workspace.yml")
  ) {
    return "pnpm-workspace";
  }
  if (rootFiles.has("lerna.json")) return "lerna";
  if (rootPkg?.workspaces) return "yarn-workspace";
  return null;
}

/**
 * Derive direct children of `path` (single segment further down) from
 * the flat path list. No HTTP — the tree snapshot is the source of
 * truth for layout.
 */
function listChildren(
  snapshot: TreeSnapshot,
  path: string,
): InspectEntry[] {
  const prefix = path === "" ? "" : `${path}/`;
  const seen = new Map<string, "dir" | "file">();
  for (const [p, type] of snapshot.pathTypes) {
    if (!p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf("/");
    if (slash === -1) {
      // Direct child — could be either file or dir; trust pathTypes.
      seen.set(rest, type);
    } else {
      // The child is the first segment, always a dir.
      const name = rest.slice(0, slash);
      if (!seen.has(name)) seen.set(name, "dir");
    }
  }
  return [...seen.entries()]
    .map(([name, type]) => ({ name, type }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

function expandWorkspacePackages(
  snapshot: TreeSnapshot,
  globs: string[],
): string[] {
  const out = new Set<string>();
  const directories = new Set<string>();
  for (const [p, type] of snapshot.pathTypes) {
    if (type === "dir") directories.add(p);
  }
  for (const g of globs) {
    if (g.endsWith("/*")) {
      const base = g.slice(0, -2);
      for (const d of directories) {
        if (d.startsWith(`${base}/`) && !d.slice(base.length + 1).includes("/")) {
          out.add(d);
        }
      }
    } else {
      if (directories.has(g)) out.add(g);
    }
  }
  return [...out].sort();
}

function collectWorkspaceGlobs(pkg: PkgJson | null): string[] {
  if (!pkg?.workspaces) return ["apps/*", "packages/*"];
  if (Array.isArray(pkg.workspaces)) return pkg.workspaces;
  return pkg.workspaces.packages ?? [];
}

async function detectFrameworkForPath(
  binding: RepoBinding,
  snapshot: TreeSnapshot,
  path: string,
  gitRepoId: string,
): Promise<FrameworkKind> {
  const pkgPath = path ? `${path}/package.json` : "package.json";
  if (snapshot.pathTypes.get(pkgPath) === "file") {
    const pkg = await fetchPackageJson(binding, pkgPath, gitRepoId);
    const fromPkg = detectFromPkg(pkg);
    if (fromPkg && fromPkg !== "node") return fromPkg;
    // package.json says "just node" — peek at other signal files
    // BEFORE giving up, in case the repo has both (rare but possible).
  }
  // Non-Node signals — all derived from the tree snapshot, no HTTP.
  const sig = (filename: string) =>
    snapshot.pathTypes.get(path ? `${path}/${filename}` : filename) === "file";
  if (sig("go.mod")) return "go";
  if (sig("pyproject.toml") || sig("requirements.txt")) return "python";
  if (sig("Cargo.toml")) return "rust";
  if (sig("Gemfile")) return "ruby";
  // No non-Node signal — fall back to the package.json verdict if we
  // had one, even if it was just "node".
  if (snapshot.pathTypes.get(pkgPath) === "file") {
    const pkg = await fetchPackageJson(binding, pkgPath, gitRepoId);
    return detectFromPkg(pkg);
  }
  return null;
}

export async function inspectRepoTree(args: {
  gitRepoId: string;
  path: string;
}): Promise<
  Result<
    InspectResult,
    | InspectRepoNotFoundError
    | InspectRepoUpstreamError
    | InspectRepoRateLimitedError
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
  const framework = await detectFrameworkForPath(
    binding,
    snap.value,
    path,
    args.gitRepoId,
  );

  let monorepo: MonorepoKind = null;
  let monorepoPackages: string[] = [];
  if (path === "") {
    const rootPkg = snap.value.pathTypes.get("package.json") === "file"
      ? await fetchPackageJson(binding, "package.json", args.gitRepoId)
      : null;
    monorepo = detectMonorepoFromPaths(snap.value.paths, rootPkg);
    if (monorepo) {
      monorepoPackages = expandWorkspacePackages(
        snap.value,
        collectWorkspaceGlobs(rootPkg),
      );
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

// Files that, if committed, leak real secrets — flagged to the operator.
const COMMITTED_ENV_FILES = [".env", ".env.local", ".env.production"];
// Template files we harvest keys from, in precedence order.
const ENV_TEMPLATE_FILES = [
  ".env.example",
  ".env.sample",
  ".env.template",
  ".env.dist",
];
const ENV_KEY_RE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/** Pull the variable names out of a dotenv-format file (values ignored). */
function parseEnvKeys(content: string): string[] {
  const keys = new Set<string>();
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = ENV_KEY_RE.exec(line);
    if (m?.[1]) keys.add(m[1]);
  }
  return Array.from(keys);
}

/** Raw text read of a single file (no JSON parse), mirroring fetchPackageJson. */
async function fetchTextFile(
  binding: RepoBinding,
  path: string,
): Promise<string | null> {
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
    | InspectRepoNotFoundError
    | InspectRepoUpstreamError
    | InspectRepoRateLimitedError
  >
> {
  const binding = await resolveRepoBinding(gitRepoId);
  if (!binding) return Result.err(new InspectRepoNotFoundError());

  const snapshot = await getTreeSnapshot(binding, gitRepoId);
  if (snapshot.isErr()) return Result.err(snapshot.error);

  const base = path ? `${path.replace(/\/+$/, "")}/` : "";
  const isFile = (name: string) =>
    snapshot.value.pathTypes.get(`${base}${name}`) === "file";

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
    | InspectRepoNotFoundError
    | InspectRepoUpstreamError
    | InspectRepoRateLimitedError
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
      return Result.err(
        new InspectRepoRateLimitedError(rateLimitReset(res), authenticated),
      );
    }
    if (!res.ok) {
      return Result.err(
        new InspectRepoUpstreamError(
          res.status,
          humanizeUpstreamBody(body, res.status),
        ),
      );
    }

    const parsed = Result.try(() => JSON.parse(body) as unknown);
    if (parsed.isErr()) {
      return Result.err(
        new InspectRepoUpstreamError(502, "Could not parse GitHub response"),
      );
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

/**
 * Trim GitHub's JSON error body to its `message` field when possible —
 * the picker shows this string verbatim. Keeps the rate-limit body off
 * the screen if we somehow miss the typed detection above.
 */
function humanizeUpstreamBody(body: string, status: number): string {
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
