/**
 * Write-back: commit status + sticky PR comment (the "preview bot").
 *
 * The App manifest already requests `checks: write` + `pull_requests: write`
 * (git/manifest.ts) and subscribes `pull_request`, so no re-consent is needed
 * to call these. Used by the preview lifecycle to report build state on the
 * commit and post the preview URL on the PR. See docs/designs/pr-previews.md.
 *
 * Split out of `github-app.ts` (which keeps the auth primitives) purely for
 * file-size reasons; `github-app.ts` re-exports everything here, so import
 * sites are unchanged.
 */

import { createError } from "evlog";
import * as z from "zod";

import { type GithubAppConfig, loadGithubAppForInstallation } from "./github-app-config";
import { getInstallationToken, ghFetch, parseGithubResponse } from "./github-app-core";

/** Marker hidden in a PR comment body so we can find + update our own comment
 *  instead of posting a new one on every deploy. */
export const PR_COMMENT_MARKER = "<!-- otterdeploy-preview -->";

export type CommitStatusState = "error" | "failure" | "pending" | "success";

const githubJsonHeaders = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
});

/** Installation token + App config (for the API base URL) in one shot. Both
 *  reads are cheap and independent, so they run in parallel. */
async function installationAuth(
  installationId: string,
): Promise<{ token: string; config: GithubAppConfig }> {
  const [tokenResp, config] = await Promise.all([
    getInstallationToken(installationId),
    loadGithubAppForInstallation(installationId),
  ]);
  return { token: tokenResp.token, config };
}

/**
 * Sets a commit status on `sha` (the small ✓/✗ next to a commit/PR). Maps a
 * deployment's lifecycle to `pending | success | failure | error`; `targetUrl`
 * deep-links to the preview (on success) or the build logs (on failure).
 */
export async function createCommitStatus(input: {
  installationId: string;
  owner: string;
  repo: string;
  sha: string;
  state: CommitStatusState;
  targetUrl?: string | null;
  description?: string;
  context?: string;
}): Promise<void> {
  const { token, config } = await installationAuth(input.installationId);
  const res = await ghFetch(
    `${config.apiBaseUrl}/repos/${input.owner}/${input.repo}/statuses/${input.sha}`,
    {
      method: "POST",
      headers: githubJsonHeaders(token),
      body: JSON.stringify({
        state: input.state,
        target_url: input.targetUrl ?? undefined,
        // GitHub caps status descriptions at 140 chars.
        description: input.description?.slice(0, 140),
        context: input.context ?? "otterdeploy/preview",
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw createError({
      message: `GitHub commit-status update failed (${res.status})`,
      status: 502,
      why: body.slice(0, 500),
    });
  }
}

interface IssueComment {
  id: number;
  body?: string | null;
}

/** Only the fields the sticky-comment upsert reads; zod strips the rest.
 *  `body` is nullish-tolerant: GitHub can omit it on minimal responses. */
const issueCommentListSchema = z.array(
  z.object({
    id: z.number(),
    body: z.string().nullish(),
  }) satisfies z.ZodType<IssueComment>,
);

/** Find our own (marker-bearing) comment on a PR, walking pages. Returns null
 *  if we've never commented. */
async function findMarkedComment(input: {
  config: GithubAppConfig;
  token: string;
  owner: string;
  repo: string;
  prNumber: number;
  marker: string;
}): Promise<IssueComment | null> {
  let page = 1;
  while (true) {
    const res = await ghFetch(
      `${input.config.apiBaseUrl}/repos/${input.owner}/${input.repo}/issues/${input.prNumber}/comments?per_page=100&page=${page}`,
      { headers: githubJsonHeaders(input.token) },
    );
    if (!res.ok) {
      const body = await res.text();
      throw createError({
        message: `GitHub PR comment list failed (${res.status})`,
        status: 502,
        why: body.slice(0, 500),
      });
    }
    const comments = parseGithubResponse(
      issueCommentListSchema,
      await res.json(),
      "PR comment list",
    );
    const found = comments.find((c) => c.body?.includes(input.marker));
    if (found) return found;
    if (comments.length < 100) return null;
    page++;
    if (page > 20) return null; // safety stop
  }
}

/**
 * Upserts a single sticky comment on a PR: updates our existing (marker-bearing)
 * comment if present, else posts a new one. Keeps the PR to one otterdeploy
 * comment that we edit in place as the deploy progresses, rather than spamming.
 */
export async function upsertPrComment(input: {
  installationId: string;
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
  marker?: string;
}): Promise<void> {
  const marker = input.marker ?? PR_COMMENT_MARKER;
  const { token, config } = await installationAuth(input.installationId);
  const bodyWithMarker = `${marker}\n${input.body}`;

  const existing = await findMarkedComment({ config, token, ...input, marker });

  const url = existing
    ? `${config.apiBaseUrl}/repos/${input.owner}/${input.repo}/issues/comments/${existing.id}`
    : `${config.apiBaseUrl}/repos/${input.owner}/${input.repo}/issues/${input.prNumber}/comments`;
  const res = await ghFetch(url, {
    method: existing ? "PATCH" : "POST",
    headers: githubJsonHeaders(token),
    body: JSON.stringify({ body: bodyWithMarker }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw createError({
      message: `GitHub PR comment ${existing ? "update" : "create"} failed (${res.status})`,
      status: 502,
      why: body.slice(0, 500),
    });
  }
}
