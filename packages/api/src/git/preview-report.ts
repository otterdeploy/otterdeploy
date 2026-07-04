/**
 * Report preview state back to GitHub — best-effort: a GitHub API failure must
 * never fail the webhook (it returns 200 so GitHub stops retrying), so each call
 * is wrapped and only logged on error. Split out of handle-pull-request.ts to
 * keep that orchestrator under the file-length gate.
 */

import { Result } from "better-result";
import { log } from "evlog";

import { createCommitStatus, upsertPrComment } from "./github-app";

export async function report(input: {
  installationId: string | null;
  owner: string | undefined;
  repo: string | undefined;
  prNumber: number;
  sha: string;
  phase: "building" | "closed";
}): Promise<void> {
  const { installationId, owner, repo, prNumber, sha, phase } = input;
  // Public repos have no installation and can't be written to via an App token.
  if (!installationId || !owner || !repo) return;

  const body =
    phase === "building"
      ? `**Preview environment** for PR #${prNumber} is building… otterdeploy will update this comment when it's live.`
      : `**Preview environment** for PR #${prNumber} has been torn down.`;

  const comment = await Result.tryPromise({
    try: () => upsertPrComment({ installationId, owner, repo, prNumber, body }),
    catch: (cause) => cause,
  });
  if (comment.isErr()) {
    log.warn({ github: { event: "pull_request", step: "comment", prNumber }, err: comment.error });
  }

  if (phase === "building") {
    const status = await Result.tryPromise({
      try: () =>
        createCommitStatus({
          installationId,
          owner,
          repo,
          sha,
          state: "pending",
          description: "Preview building…",
          context: "otterdeploy/preview",
        }),
      catch: (cause) => cause,
    });
    if (status.isErr()) {
      log.warn({ github: { event: "pull_request", step: "status", prNumber }, err: status.error });
    }
  }
}
