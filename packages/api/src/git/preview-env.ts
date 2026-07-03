/**
 * Preview-environment lifecycle — the `kind: "preview"` rows that a PR spins up.
 * Find-or-create on open/synchronize (keyed by the (project, pr_number) unique
 * index), mark closed on PR close. Pure DB access; the runtime side-effects
 * (branching DBs, tearing down containers) are driven by the webhook handler.
 * See docs/designs/pr-previews.md §7.
 */
import type { EnvironmentId, GitRepoId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { environment } from "@otterdeploy/db/schema/project";
import { and, eq } from "drizzle-orm";

export type EnvironmentRow = typeof environment.$inferSelect;

export interface EnsurePreviewInput {
  projectId: ProjectId;
  /** The env a preview inherits vars from — the project's persistent env. */
  baseEnvironmentId: EnvironmentId | null;
  gitRepoId: GitRepoId;
  prNumber: number;
  prNodeId: string | null;
  headRef: string;
  headSha: string;
}

/**
 * Find-or-create the preview env for a PR. Idempotent via the
 * (project_id, pull_request_number) unique index: a reopen/synchronize updates
 * the head + reactivates instead of inserting a duplicate.
 */
export async function ensurePreviewEnvironment(
  input: EnsurePreviewInput,
): Promise<EnvironmentRow | undefined> {
  const [row] = await db
    .insert(environment)
    .values({
      projectId: input.projectId,
      name: `PR #${input.prNumber}`,
      slug: `pr-${input.prNumber}`,
      kind: "preview",
      state: "active",
      baseEnvironmentId: input.baseEnvironmentId,
      gitRepoId: input.gitRepoId,
      gitRef: input.headRef,
      pullRequestNumber: input.prNumber,
      pullRequestNodeId: input.prNodeId,
      headSha: input.headSha,
    })
    .onConflictDoUpdate({
      target: [environment.projectId, environment.pullRequestNumber],
      set: {
        gitRef: input.headRef,
        headSha: input.headSha,
        state: "active",
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

/**
 * Mark a PR's preview env(s) closed and return the affected rows so the caller
 * can tear down their compute + branched databases. Only touches preview envs.
 */
export async function markPreviewEnvironmentsClosed(
  projectId: ProjectId,
  prNumber: number,
): Promise<EnvironmentRow[]> {
  return db
    .update(environment)
    .set({ state: "closed", updatedAt: new Date() })
    .where(
      and(
        eq(environment.projectId, projectId),
        eq(environment.pullRequestNumber, prNumber),
        eq(environment.kind, "preview"),
      ),
    )
    .returning();
}
