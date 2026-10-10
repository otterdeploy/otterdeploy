/**
 * Repo- and commit-level GitHub App reads: installation repo listing and
 * branch-head resolution. Split out of `github-app.ts` (which keeps the auth
 * primitives: JWT minting + installation token exchange) purely for file-size
 * reasons; `github-app.ts` re-exports everything here, so import sites are
 * unchanged.
 */

import { Result } from "better-result";
import { createError } from "evlog";
import * as z from "zod";

import { lsRemoteSha } from "./git-ls-remote";
import { publicGithubCloneUrl } from "./git-snapshot";
import {
  type ApiBudgetClass,
  apiBudgetSpent,
  configuredGithubToken,
  noteGithubResponse,
  noteGithubUnreachable,
  publicReadClass,
} from "./github-api-budget";
import { apiBaseUrlForHost, type GithubAppConfig } from "./github-app-config";
import { getInstallationToken, ghFetch, parseGithubResponse } from "./github-app-core";

/**
 * Lists the repos accessible to the installation. Handles GitHub's
 * pagination (max 100/page, walks until exhausted). Caller already has
 * both the App config (for the API base URL) and an installation token.
 */
export interface InstallationRepo {
  id: number;
  node_id: string;
  full_name: string;
  name: string;
  private: boolean;
  default_branch: string;
  clone_url: string;
}

const installationRepoListPageSchema = z.object({
  total_count: z.number(),
  repositories: z.array(
    z.object({
      id: z.number(),
      node_id: z.string(),
      full_name: z.string(),
      name: z.string(),
      private: z.boolean(),
      default_branch: z.string(),
      clone_url: z.string(),
    }) satisfies z.ZodType<InstallationRepo>,
  ),
});

export interface InstallationRepoList {
  repositories: InstallationRepo[];
  /**
   * GitHub's `total_count` for the installation. The truthful repo count
   * even when `repositories` is shorter (page-walk safety stop, or GitHub's
   * post-install read lag returning a partial/empty first page). Callers
   * persist THIS, never `repositories.length`.
   */
  totalCount: number;
}

export async function listInstallationRepos(
  installationToken: string,
  config: GithubAppConfig,
): Promise<InstallationRepoList> {
  const out: InstallationRepo[] = [];
  let totalCount = 0;
  let page = 1;
  while (true) {
    const res = await ghFetch(
      `${config.apiBaseUrl}/installation/repositories?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${installationToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!res.ok) {
      const body = await res.text();
      throw createError({
        message: `GitHub repos list failed (${res.status})`,
        status: 502,
        why: body.slice(0, 500),
      });
    }
    const json = parseGithubResponse(installationRepoListPageSchema, await res.json(), "repo list");
    totalCount = json.total_count;
    out.push(...json.repositories);
    if (json.repositories.length < 100) break;
    page++;
    if (page > 50) break; // safety stop: 5k repos is plenty
  }
  return { repositories: out, totalCount };
}

/** The head commit of a branch: what a push payload would have told us. */
export interface BranchHead {
  sha: string;
  /** Full commit message (subject + body). Null when GitHub omits it. */
  message: string | null;
  /** Commit author's display name (the git author, not the pusher). */
  authorName: string | null;
  /** Avatar of the GitHub account the commit is attributed to. Null when the
   *  commit's email matches no GitHub user. */
  authorAvatar: string | null;
}

const commitResponseSchema = z.object({
  sha: z.string().nullish(),
  commit: z
    .object({
      message: z.string().nullish(),
      author: z.object({ name: z.string().nullish() }).nullish(),
    })
    .nullish(),
  author: z.object({ avatar_url: z.string().nullish(), login: z.string().nullish() }).nullish(),
});

type CommitLookup =
  | { kind: "ok"; head: BranchHead }
  | { kind: "refused"; status: number; error: Error }
  | { kind: "unreachable"; error: Error };

/**
 * One commits-endpoint request. Never throws for a GitHub answer: the caller
 * decides whether a refusal is fatal. `budget` names the rate limit the request
 * draws on (null for an installation token, whose 5000 an hour is not tracked).
 */
async function requestCommit(
  token: string | null,
  budget: ApiBudgetClass | null,
  { owner, repo, ref }: { owner: string; repo: string; ref: string },
): Promise<CommitLookup> {
  const sent = await Result.tryPromise(() =>
    ghFetch(
      `${apiBaseUrlForHost("github.com")}/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    ),
  );
  if (sent.isErr()) {
    // Blocked egress, DNS, timeout: the API is not there to ask.
    if (budget) noteGithubUnreachable(budget);
    return {
      kind: "unreachable",
      error: sent.error.cause instanceof Error ? sent.error.cause : sent.error,
    };
  }
  const res = sent.value;
  if (!res.ok) {
    const body = await res.text();
    if (budget) noteGithubResponse(budget, res, body);
    return {
      kind: "refused",
      status: res.status,
      error: createError({
        message: `GitHub commit lookup failed for ${owner}/${repo}@${ref} (${res.status})`,
        status: 502,
        why: body.slice(0, 500),
      }),
    };
  }
  if (budget) noteGithubResponse(budget, res);
  return {
    kind: "ok",
    head: commitFromJson(
      parseGithubResponse(commitResponseSchema, await res.json(), "commit lookup"),
      {
        owner,
        repo,
        ref,
      },
    ),
  };
}

/** `commit.author` is the git trailer (always present); the top-level `author`
 *  is the GitHub ACCOUNT it maps to, which is null for a commit whose email
 *  belongs to no user, hence the separate name/avatar sources. Everything is
 *  nullish-tolerant: a missing field degrades the provenance, never the build. */
function commitFromJson(
  json: z.infer<typeof commitResponseSchema>,
  { owner, repo, ref }: { owner: string; repo: string; ref: string },
): BranchHead {
  if (!json.sha) {
    throw createError({
      message: `GitHub returned no SHA for ${owner}/${repo}@${ref}`,
      status: 502,
    });
  }
  return {
    sha: json.sha,
    message: json.commit?.message ?? null,
    authorName: json.commit?.author?.name ?? json.author?.login ?? null,
    authorAvatar: json.author?.avatar_url ?? null,
  };
}

function unwrapCommit(lookup: CommitLookup): BranchHead {
  if (lookup.kind === "ok") return lookup.head;
  throw lookup.error;
}

type CommitMeta = Omit<BranchHead, "sha">;
const COMMIT_META_CACHE_MAX = 500;
/** A commit's message and author never change, so what the API said once is
 *  kept: a redeploy of an unchanged head (the common case) spends no request. */
const commitMetaCache = new Map<string, CommitMeta>();

function rememberCommitMeta(key: string, head: BranchHead): void {
  if (commitMetaCache.size >= COMMIT_META_CACHE_MAX) {
    const oldest = commitMetaCache.keys().next();
    if (!oldest.done) commitMetaCache.delete(oldest.value);
  }
  commitMetaCache.set(key, {
    message: head.message,
    authorName: head.authorName,
    authorAvatar: head.authorAvatar,
  });
}

/** Test seam: forget the commit-metadata cache. */
export function resetCommitMetaCache(): void {
  commitMetaCache.clear();
}

const FULL_SHA = /^[0-9a-f]{40}$/;
const NO_PROVENANCE: CommitMeta = { message: null, authorName: null, authorAvatar: null };

/** A 404/422 from the commits endpoint means no such commit or repo. */
function definitelyAbsent(lookup: CommitLookup): boolean {
  return lookup.kind === "refused" && (lookup.status === 404 || lookup.status === 422);
}

/**
 * The head of a PUBLIC repo, with no installation linked.
 *
 * The commit comes from `git ls-remote`: git has no request budget, and
 * GitHub's REST API gives an anonymous caller 60 an hour per IP, shared with
 * repo inspection and with tenant builds (after a few public-repo deploys
 * every next one failed "GitHub commit lookup failed (403)"). The API is then asked only for what git cannot say, the commit's
 * message and author, once per commit and only while its budget lasts; without
 * it the deployment simply carries no provenance.
 *
 * When git cannot see the repo at all (private, or no route to github.com) the
 * API is the only road and its failure is the deploy's, as before.
 */
async function publicBranchHead(owner: string, repo: string, branch: string): Promise<BranchHead> {
  const budget = publicReadClass();
  const token = configuredGithubToken();
  const cloneUrl = publicGithubCloneUrl(owner, repo);
  // A full SHA is "resolved" by ls-remote without asking anyone, which would
  // let a mistyped pin through; the API (or the cache) still has to vouch.
  const viaGit = FULL_SHA.test(branch) || !cloneUrl ? null : await lsRemoteSha(cloneUrl, branch);

  if (!viaGit) {
    const cached = FULL_SHA.test(branch)
      ? commitMetaCache.get(`${owner}/${repo}@${branch}`.toLowerCase())
      : undefined;
    if (cached) return { sha: branch, ...cached };
    if (FULL_SHA.test(branch) && apiBudgetSpent(budget)) return { sha: branch, ...NO_PROVENANCE };
    const lookup = await requestCommit(token, budget, { owner, repo, ref: branch });
    // Out of budget or unreachable, but the ref IS a commit id: nothing left
    // for the API to decide except provenance.
    if (FULL_SHA.test(branch) && lookup.kind !== "ok" && !definitelyAbsent(lookup)) {
      return { sha: branch, ...NO_PROVENANCE };
    }
    const head = unwrapCommit(lookup);
    rememberCommitMeta(`${owner}/${repo}@${head.sha}`.toLowerCase(), head);
    return head;
  }

  const key = `${owner}/${repo}@${viaGit}`.toLowerCase();
  const known = commitMetaCache.get(key);
  if (known) return { sha: viaGit, ...known };
  if (apiBudgetSpent(budget)) return { sha: viaGit, ...NO_PROVENANCE };
  const lookup = await requestCommit(token, budget, { owner, repo, ref: viaGit });
  if (lookup.kind !== "ok") return { sha: viaGit, ...NO_PROVENANCE };
  rememberCommitMeta(key, lookup.head);
  return { ...lookup.head, sha: viaGit };
}

/**
 * Resolve the head commit of a branch.
 * Used by the UI "Deploy" path (manifest apply) to mint a build the same
 * way a git push would. The push webhook gets the commit from its payload,
 * but a UI-triggered build has to ask for the branch head itself.
 *
 * Returns the whole commit, not just the SHA: the deployment card names the
 * change and its author, and this response already carries both. Reading only
 * `.sha` here is what left every non-push deployment with null provenance and
 * a framework glyph where a face belongs.
 *
 * Linked to an installation (private repos) it asks the API with the
 * installation token. With none (public repos) see {@link publicBranchHead}.
 *
 * Throws (createError) on failure, matching this module's idiom; callers
 * in Result-returning code wrap with `Result.tryPromise`.
 */
export async function fetchBranchHead(
  installationId: string | null,
  owner: string,
  repo: string,
  branch: string,
): Promise<BranchHead> {
  if (!installationId) return publicBranchHead(owner, repo, branch);
  const token = (await getInstallationToken(installationId)).token;
  return unwrapCommit(await requestCommit(token, null, { owner, repo, ref: branch }));
}

/** Head SHA only: for callers that pin a build and don't render provenance. */
export async function fetchBranchHeadSha(
  installationId: string | null,
  owner: string,
  repo: string,
  branch: string,
): Promise<string> {
  return (await fetchBranchHead(installationId, owner, repo, branch)).sha;
}
