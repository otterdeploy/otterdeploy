/**
 * Fill in commit provenance for deployment rows that don't have it.
 *
 * `gitCommitMessage`/`gitCommitAuthor` are captured when a deployment is
 * created, so any row written before that capture existed on its code path.
 * Every preview build until recently. Reads "Git deployment" with a bare ref
 * and a short sha. That names nothing: not what changed, not who changed it.
 *
 * The information was never lost, only unrecorded: the row holds the SHA and
 * the resource knows its repo, so the commit is one lookup away. Rather than
 * waiting for a future build to write it, resolve it the first time anyone
 * looks and persist it, so each commit costs one GitHub call ever.
 *
 * Bounded on purpose:
 *  - only rows that are missing it AND have a SHA
 *  - deduped by SHA, so ten deployments of one commit are one lookup
 *  - capped per call, so a long history doesn't fan out into a burst
 *  - failures are silent and non-fatal. Provenance is presentation, and a
 *    rate-limited GitHub must never turn a deployment list into an error
 */

import type { DeploymentId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { gitRepo } from "@otterdeploy/db/schema/git";
import { deployment, serviceResource } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { fetchBranchHead } from "../../git/github-app";
import { resolveInstallationId } from "../../git/installation-id";

/** Most commits to resolve in one pass. A panel shows a page of history; the
 *  rest fill in as they're viewed. */
const MAX_LOOKUPS = 8;

export interface CommitMeta {
  gitCommitMessage: string | null;
  gitCommitAuthor: string | null;
  gitCommitAuthorAvatar: string | null;
}

interface BackfillRow {
  id: string;
  gitSha: string | null;
  gitCommitMessage: string | null;
}

/**
 * Resolve and persist missing commit metadata for these deployments.
 * Returns a map of deployment id → metadata for the rows it filled, so the
 * caller can answer the CURRENT request with it rather than making the reader
 * refresh to see the result of their own read.
 */
export async function backfillCommitMeta(
  resourceId: ResourceId,
  rows: BackfillRow[],
): Promise<Map<string, CommitMeta>> {
  const filled = new Map<string, CommitMeta>();
  const missing = rows.filter((r) => r.gitSha && !r.gitCommitMessage);
  if (missing.length === 0) return filled;

  // Which repo this service builds from, no repo, nothing to ask.
  const [svc] = await db
    .select({ gitRepoId: serviceResource.gitRepoId })
    .from(serviceResource)
    .where(eq(serviceResource.resourceId, resourceId))
    .limit(1);
  if (!svc?.gitRepoId) return filled;

  const [repo] = await db
    .select({ fullName: gitRepo.fullName, installationId: gitRepo.installationId })
    .from(gitRepo)
    .where(eq(gitRepo.id, svc.gitRepoId))
    .limit(1);
  if (!repo) return filled;
  const [owner, name] = repo.fullName.split("/");
  if (!owner || !name) return filled;
  const installationId = await resolveInstallationId(repo.installationId);

  // One lookup per distinct commit, not per deployment.
  const shas = [...new Set(missing.map((r) => r.gitSha as string))].slice(0, MAX_LOOKUPS);
  for (const sha of shas) {
    const head = await Result.tryPromise({
      try: () => fetchBranchHead(installationId, owner, name, sha),
      catch: (cause) => cause,
    });
    if (head.isErr()) continue;
    const meta: CommitMeta = {
      gitCommitMessage: head.value.message,
      gitCommitAuthor: head.value.authorName,
      gitCommitAuthorAvatar: head.value.authorAvatar,
    };
    // Nothing to record if GitHub had no message either. Don't rewrite the
    // row just to store the same nulls and re-ask on every future read.
    if (meta.gitCommitMessage == null && meta.gitCommitAuthor == null) continue;

    // Persist for every row on this commit, but only where it is still absent:
    // a concurrent write must not be clobbered.
    const ids = missing.filter((r) => r.gitSha === sha).map((r) => r.id as DeploymentId);
    await db
      .update(deployment)
      .set(meta)
      .where(and(inArray(deployment.id, ids), isNull(deployment.gitCommitMessage)));
    for (const id of ids) filled.set(id, meta);
  }
  return filled;
}
