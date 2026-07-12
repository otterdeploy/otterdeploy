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
import { env as serverEnv } from "@otterdeploy/env/server";
import { and, eq, sql } from "drizzle-orm";

/** Idle-teardown instant for a freshly opened preview, or null when idle
 *  teardown is disabled (PREVIEW_IDLE_TEARDOWN_HOURS=0). */
export function defaultTeardownAt(): Date | null {
  const hours = serverEnv.PREVIEW_IDLE_TEARDOWN_HOURS;
  return hours > 0 ? new Date(Date.now() + hours * 60 * 60 * 1000) : null;
}

/**
 * The on-conflict `auto_teardown_at` bump: keep a keep-alive pin (NULL) NULL,
 * otherwise set the fresh teardown instant. Must be a raw `sql` fragment because
 * it reads the existing column value — which means drizzle does NOT map the
 * value for us, so we bind an ISO string and cast it to `timestamp` explicitly.
 * A bare Date binds as `Date.toString()` (invalid syntax) and a bare string
 * binds as `text` (type mismatch); both fail. See __tests__/preview-env.test.ts.
 */
export function teardownBumpFragment(teardownAt: Date) {
  return sql`case when ${preview.autoTeardownAt} is null then null else ${teardownAt.toISOString()}::timestamp end`;
}

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
  // Compute once so the insert value and the conflict-branch bump agree.
  const teardownAt = defaultTeardownAt();
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
      autoTeardownAt: teardownAt,
    })
    .onConflictDoUpdate({
      target: [preview.projectId, preview.gitRepoId, preview.prNumber],
      set: {
        branch: input.branch,
        headSha: input.headSha,
        state: "active",
        // A push is an implicit resume — clear a stale pause so the rebuilt
        // containers aren't left flagged paused (and reaper-exempt) forever.
        paused: false,
        // A push is activity — extend the idle clock, but PRESERVE a keep-alive
        // pin: if the existing row was pinned (auto_teardown_at IS NULL) keep it
        // NULL; otherwise bump to a fresh default. Skip when idle teardown is
        // globally disabled. NOTE: inside a raw `sql` template drizzle does NOT
        // apply the column's timestamp mapper — a bare Date binds as
        // `Date.toString()` (rejected as invalid timestamp), and a bare ISO
        // string binds as `text` (rejected: "column is timestamp but expression
        // is text", since Postgres type-checks this CASE even on a fresh insert).
        // So bind the ISO string and cast it to `timestamp` explicitly.
        ...(teardownAt ? { autoTeardownAt: teardownBumpFragment(teardownAt) } : {}),
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
    .set({ state: "closed", paused: false, updatedAt: new Date() })
    .where(
      and(
        eq(preview.projectId, projectId),
        eq(preview.gitRepoId, gitRepoId),
        eq(preview.prNumber, prNumber),
      ),
    )
    .returning();
}
