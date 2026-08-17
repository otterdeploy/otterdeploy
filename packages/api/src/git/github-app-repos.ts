/**
 * Repo- and commit-level GitHub App reads: installation repo listing and
 * branch-head resolution. Split out of `github-app.ts` (which keeps the auth
 * primitives: JWT minting + installation token exchange) purely for file-size
 * reasons; `github-app.ts` re-exports everything here, so import sites are
 * unchanged.
 */

import { createError } from "evlog";
import * as z from "zod";

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

/**
 * Resolve the head commit of a branch via the installation token.
 * Used by the UI "Deploy" path (manifest apply) to mint a build the same
 * way a git push would. The push webhook gets the commit from its payload,
 * but a UI-triggered build has to ask GitHub for the branch head itself.
 *
 * Returns the whole commit, not just the SHA: the deployment card names the
 * change and its author, and this response already carries both. Reading only
 * `.sha` here is what left every non-push deployment with null provenance and
 * a framework glyph where a face belongs.
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
  // Public repos resolve their head anonymously (no installation linked).
  // GitHub's commits endpoint is readable without auth for public repos.
  // Rate-limited to 60/hr per IP, fine for the UI deploy path.
  // Private repos pass a real installation token.
  const token = installationId ? (await getInstallationToken(installationId)).token : null;
  const res = await ghFetch(
    `${apiBaseUrlForHost("github.com")}/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`,
    {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw createError({
      message: `GitHub commit lookup failed for ${owner}/${repo}@${branch} (${res.status})`,
      status: 502,
      why: body.slice(0, 500),
    });
  }
  // `commit.author` is the git trailer (always present); the top-level `author`
  // is the GitHub ACCOUNT it maps to, which is null for a commit whose email
  // belongs to no user, hence the separate name/avatar sources. Everything is
  // nullish-tolerant: a missing field degrades the provenance, never the build.
  const json = parseGithubResponse(
    z.object({
      sha: z.string().nullish(),
      commit: z
        .object({
          message: z.string().nullish(),
          author: z.object({ name: z.string().nullish() }).nullish(),
        })
        .nullish(),
      author: z.object({ avatar_url: z.string().nullish(), login: z.string().nullish() }).nullish(),
    }),
    await res.json(),
    "commit lookup",
  );
  if (!json.sha) {
    throw createError({
      message: `GitHub returned no SHA for ${owner}/${repo}@${branch}`,
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

/** Head SHA only: for callers that pin a build and don't render provenance. */
export async function fetchBranchHeadSha(
  installationId: string | null,
  owner: string,
  repo: string,
  branch: string,
): Promise<string> {
  return (await fetchBranchHead(installationId, owner, repo, branch)).sha;
}
