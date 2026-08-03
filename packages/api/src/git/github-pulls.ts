/**
 * Pull-request reads against the GitHub API.
 *
 * Split from `github-app.ts` to keep that file under its line cap — it already
 * carries app auth, installation lookup, repo listing, commit status and PR
 * comments. Anything that only READS a pull request belongs here.
 */
import { createError } from "evlog";
import * as z from "zod";

import { apiBaseUrlForHost, getInstallationToken, ghFetch } from "./github-app";

/**
 * The slice of GitHub's pull-request payload we depend on.
 *
 * Parsed rather than cast: a cast asserts a shape we have not checked, so a
 * changed or truncated response would surface as `undefined` deep inside the
 * preview path — a build for `head.sha = undefined` — instead of here, at the
 * boundary, with a message naming the field.
 */
const pullRequestHeadSchema = z.object({
  head: z.object({ ref: z.string().min(1), sha: z.string().min(1) }),
  // Presentation only — `nullish` throughout so a missing field degrades the
  // card, never the build.
  title: z.string().nullish(),
  html_url: z.string().nullish(),
  user: z.object({ login: z.string().nullish(), avatar_url: z.string().nullish() }).nullish(),
  // Absent on some enterprise responses; the caller only refuses non-open PRs,
  // so defaulting to open preserves that behaviour without a second branch.
  state: z.string().default("open"),
  node_id: z.string().nullish(),
});

export interface PullRequestHead {
  ref: string;
  sha: string;
  state: string;
  nodeId: string | null;
  title: string | null;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  url: string | null;
}

/**
 * The head ref + sha of one pull request.
 *
 * The `issue_comment` webhook carries the issue, not the PR, so a
 * comment-triggered preview has to resolve what to build. Mirrors
 * `fetchBranchHeadSha`: anonymous for public repos, installation token
 * otherwise.
 */
export async function fetchPullRequestHead(
  installationId: string | null,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PullRequestHead> {
  const token = installationId ? (await getInstallationToken(installationId)).token : null;
  const res = await ghFetch(
    `${apiBaseUrlForHost("github.com")}/repos/${owner}/${repo}/pulls/${prNumber}`,
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
      message: `GitHub pull-request lookup failed for ${owner}/${repo}#${prNumber} (${res.status})`,
      status: 502,
      why: body.slice(0, 500),
    });
  }
  const parsed = pullRequestHeadSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw createError({
      message: `GitHub returned an unusable pull request for ${owner}/${repo}#${prNumber}`,
      status: 502,
      why: z.prettifyError(parsed.error),
    });
  }
  return {
    ref: parsed.data.head.ref,
    sha: parsed.data.head.sha,
    state: parsed.data.state,
    nodeId: parsed.data.node_id ?? null,
    title: parsed.data.title ?? null,
    authorLogin: parsed.data.user?.login ?? null,
    authorAvatarUrl: parsed.data.user?.avatar_url ?? null,
    url: parsed.data.html_url ?? null,
  };
}
