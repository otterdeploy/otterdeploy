/**
 * How many previews one project may have open at once.
 *
 * Idle teardown (`preview-reaper.ts`) bounds how LONG a preview lives. Nothing
 * bounded how MANY existed, so a busy repository could open twenty pull
 * requests and provision twenty databases: the disk cost scales with review
 * activity rather than with anything the operator chose.
 *
 * Two rules make this behave the way an operator expects:
 *
 *   1. **Refuse, never evict.** At the cap the NEW preview is turned away and
 *      told why. Evicting the oldest would tear down a preview someone is
 *      actively reviewing to make room for one nobody has opened yet, and the
 *      person who lost theirs would have no idea why.
 *   2. **An existing preview is never re-capped.** A push to an already-open PR
 *      updates its preview, so it must pass even when the project is at or over
 *      the cap. Refusing there would strand an in-flight review at a stale
 *      commit: the cap would break the previews it was meant to protect.
 *
 * Pinned previews count. So do comment-triggered ones. A cap that some route
 * can sidestep is not a cap, and pinning is exactly what someone would reach
 * for to sidestep it.
 */
import type { GitRepoId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { gitInstallation, gitRepo } from "@otterdeploy/db/schema";
import { preview } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { and, eq, ne, sql } from "drizzle-orm";
import { log } from "evlog";

import { previewMaxPerProject } from "../lib/platform-runtime-settings";
import { upsertPrComment } from "./github-app";

export type PreviewCapVerdict =
  | { allowed: true }
  | { allowed: false; cap: number; current: number };

/**
 * May this project open ONE more preview for (repo, pr)?
 *
 * Existing previews for the same (repo, pr) are excluded from the count and
 * short-circuit to allowed. See rule 2 above.
 *
 * This is a check-then-act, so two pull requests opened in the same instant can
 * both observe a free slot and land at cap+1. That is deliberate: the cap is a
 * disk guard, not a security boundary, and the alternative (serializing every
 * preview creation on a project-level lock) costs more than the overshoot. The
 * next open is refused normally.
 */
export async function checkPreviewCap(input: {
  projectId: ProjectId;
  gitRepoId: GitRepoId;
  prNumber: number;
}): Promise<PreviewCapVerdict> {
  const cap = await previewMaxPerProject();
  // 0 is the documented "no cap" value, matching PREVIEW_IDLE_TEARDOWN_HOURS.
  if (cap <= 0) return { allowed: true };

  const existing = await db
    .select({ id: preview.id })
    .from(preview)
    .where(
      and(
        eq(preview.projectId, input.projectId),
        eq(preview.gitRepoId, input.gitRepoId),
        eq(preview.prNumber, input.prNumber),
      ),
    )
    .limit(1);
  // Already has a preview. This is a synchronize, not a new slot.
  if (existing.length > 0) return { allowed: true };

  // `state = 'active'` is the occupancy test, not `paused`: a paused preview has
  // stopped containers but keeps its routes, volumes and any branched database,
  // so it is still consuming the disk the cap exists to bound. Closed previews
  // have been torn down and free their slot.
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(preview)
    .where(
      and(
        eq(preview.projectId, input.projectId),
        eq(preview.state, "active"),
        // Defensive: the row above already ruled this out, but excluding it
        // keeps the count meaningful if the two queries ever drift apart.
        ne(preview.prNumber, input.prNumber),
      ),
    );
  const current = row?.n ?? 0;
  return current >= cap ? { allowed: false, cap, current } : { allowed: true };
}

/**
 * What the pull request is told when its preview is refused. Names the number
 * and the two ways out, because "at capacity" with no next step is the kind of
 * message that generates a support question rather than an action.
 */
export function previewCapMessage(verdict: { cap: number; current: number }): string {
  return [
    `**Preview not created**. This project is at its limit of ${verdict.cap} concurrent previews (${verdict.current} open).`,
    "",
    "Close or tear down another preview to free a slot, or raise the limit in Settings → Instance.",
  ].join("\n");
}

/**
 * Post the refusal to the pull request.
 *
 * Deliberately does NOT go through `preview-report.ts`: that path loads a
 * snapshot keyed on an existing preview row, and the entire point here is that
 * no preview was created. It resolves the write-back identity directly from the
 * repo instead.
 *
 * Best-effort and never throws. A repo with no App installation (a public fork,
 * a soft-revoked install) cannot be commented on at all. The refusal is still
 * logged, which is what the operator sees.
 */
export async function reportPreviewCapRefusal(input: {
  gitRepoId: GitRepoId;
  prNumber: number;
  verdict: { cap: number; current: number };
}): Promise<void> {
  const done = await Result.tryPromise({
    try: async () => {
      const [repo] = await db
        .select()
        .from(gitRepo)
        .where(eq(gitRepo.id, input.gitRepoId))
        .limit(1);
      if (!repo?.installationId) return;
      const [owner, repoName] = repo.fullName.split("/");
      if (!owner || !repoName) return;

      // gitRepo.installationId is the internal `gitinst_` PK; GitHub's token
      // API needs the numeric id off the installation row.
      const [inst] = await db
        .select({ installationId: gitInstallation.installationId })
        .from(gitInstallation)
        .where(eq(gitInstallation.id, repo.installationId))
        .limit(1);
      if (!inst?.installationId) return;

      await upsertPrComment({
        installationId: inst.installationId,
        owner,
        repo: repoName,
        prNumber: input.prNumber,
        body: previewCapMessage(input.verdict),
      });
    },
    catch: (cause) => cause,
  });
  if (done.isErr()) {
    log.warn({
      github: { event: "pull_request", step: "preview-cap-comment", prNumber: input.prNumber },
      err: done.error,
    });
  }
}
