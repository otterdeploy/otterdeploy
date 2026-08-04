/**
 * Resolve a `git_repo` row's GitHub installation id — the one thing every
 * caller of {@link fetchBranchHead} has to get right, and the one thing that is
 * easy to get wrong.
 *
 * `gitRepo.installationId` is the INTERNAL `gitinst_` primary key. GitHub's
 * token API wants the NUMERIC installation id, which lives one join away on
 * `git_installation.installationId`. Passing the PK straight through 404s the
 * token request — and because every provenance path treats a lookup failure as
 * "no data" rather than an error, the symptom is silence: commits never get
 * named, PR comments never get authors, and nothing anywhere says why.
 *
 * This existed as three copies (preview-deploy, preview-report-state,
 * deployment-commit-backfill). Two of them were written by copying the third
 * along with its warning comment, which is precisely how the bug survives a
 * fix: the comment travels, the correctness does not. One function instead.
 */

import type { GitInstallationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { gitInstallation } from "@otterdeploy/db/schema";
import { eq } from "drizzle-orm";

/**
 * @param internalInstallationId `gitRepo.installationId` — the `gitinst_` PK,
 *   or null for a public repo with no installation linked. Typed as the branded
 *   id precisely so the numeric one can't be passed here by mistake.
 * @returns GitHub's numeric installation id as a string, or null when the repo
 *   has no installation (anonymous access) or the row has gone missing.
 */
export async function resolveInstallationId(
  internalInstallationId: GitInstallationId | null,
): Promise<string | null> {
  if (!internalInstallationId) return null;
  const [inst] = await db
    .select({ installationId: gitInstallation.installationId })
    .from(gitInstallation)
    .where(eq(gitInstallation.id, internalInstallationId))
    .limit(1);
  return inst?.installationId ?? null;
}
