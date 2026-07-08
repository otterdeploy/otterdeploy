/**
 * PR-preview lifecycle — the `preview` rows a PR spins up. A preview is a
 * first-class entity bound to (project, repo, PR#), NOT an environment: it
 * scopes its deployments/routes/branches via `previewId` columns and can never
 * surface in environment UI. Find-or-create on open/synchronize (keyed by the
 * (project_id, git_repo_id, pr_number) unique index), mark closed on PR close.
 * Pure DB access; the runtime side-effects (branching DBs, tearing down
 * containers) are driven by the webhook handler.
 */
import type { GitRepoId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { preview } from "@otterdeploy/db/schema/project";
import { and, eq } from "drizzle-orm";

export type PreviewRow = typeof preview.$inferSelect;

export interface EnsurePreviewInput {
  projectId: ProjectId;
  gitRepoId: GitRepoId;
  /** Sanitized repo slug (`owner-repo`) — qualifies the preview slug so two
   *  repos in one project don't collide on the same PR number. */
  repoSlug: string;
  prNumber: number;
  prNodeId: string | null;
  /** Plain head branch name (GitHub's pr.head.ref). */
  branch: string;
  headSha: string;
}

/**
 * Find-or-create the preview for a PR. Idempotent via the
 * (project_id, git_repo_id, pr_number) unique index: a reopen/synchronize
 * updates the head + reactivates instead of inserting a duplicate.
 */
export async function ensurePreview(input: EnsurePreviewInput): Promise<PreviewRow | undefined> {
  const [row] = await db
    .insert(preview)
    .values({
      projectId: input.projectId,
      gitRepoId: input.gitRepoId,
      prNumber: input.prNumber,
      prNodeId: input.prNodeId,
      branch: input.branch,
      headSha: input.headSha,
      slug: `${input.repoSlug}-pr-${input.prNumber}`,
      state: "active",
    })
    .onConflictDoUpdate({
      target: [preview.projectId, preview.gitRepoId, preview.prNumber],
      set: {
        branch: input.branch,
        headSha: input.headSha,
        state: "active",
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

/**
 * Mark a PR's preview(s) closed and return the affected rows so the caller can
 * tear down their compute + branched databases. Scoped by repo — closing a PR
 * on repo A must not close repo B's same-numbered preview.
 */
export async function markPreviewsClosed(
  projectId: ProjectId,
  gitRepoId: GitRepoId,
  prNumber: number,
): Promise<PreviewRow[]> {
  return db
    .update(preview)
    .set({ state: "closed", updatedAt: new Date() })
    .where(
      and(
        eq(preview.projectId, projectId),
        eq(preview.gitRepoId, gitRepoId),
        eq(preview.prNumber, prNumber),
      ),
    )
    .returning();
}
