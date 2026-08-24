/**
 * Preview build trigger. Insert preview-scoped pending deployments for a
 * project's opted-in git services and enqueue a build at a given commit.
 * Shared by the PR webhook (opened/synchronize) and the manual
 * `previews.rebuild` control.
 */
import type { GitRepoId, PreviewId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deployment, resource, serviceResource } from "@otterdeploy/db/schema";
import { gitRepo } from "@otterdeploy/db/schema/git";
import { triggerDeploy } from "@otterdeploy/jobs";
import { Result } from "better-result";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { groupDeploymentsByLane } from "../lib/build-target";
import { emitDeployStarted } from "../routers/project/deployments-emit";
import { fetchBranchHead } from "./github-app";
import { resolveInstallationId } from "./installation-id";

/**
 * Commit provenance for the deployment rows a preview build creates.
 *
 * The same fields a push deploy records. Without them the deployment reads
 * "Git deployment" with a bare ref and sha (no change described, no author)
 * which is exactly as informative as nothing. The push and manifest-apply paths
 * already capture this; preview builds were the one path that didn't.
 *
 * Resolved by SHA rather than branch: the branch may have moved on by the time
 * this runs, and the row must describe the commit actually being built.
 *
 * Best-effort by design. Provenance is presentation, so a rate-limited or
 * unreachable GitHub degrades the card, never the deploy. Nulls here read the
 * same as a preview created before this existed.
 */
async function commitProvenance(
  gitRepoId: GitRepoId,
  sha: string,
): Promise<{ message: string | null; authorName: string | null; authorAvatar: string | null }> {
  const empty = { message: null, authorName: null, authorAvatar: null };
  const [repo] = await db
    .select({ fullName: gitRepo.fullName, installationId: gitRepo.installationId })
    .from(gitRepo)
    .where(eq(gitRepo.id, gitRepoId))
    .limit(1);
  if (!repo) return empty;
  const [owner, name] = repo.fullName.split("/");
  if (!owner || !name) return empty;
  const installationId = await resolveInstallationId(repo.installationId);

  const head = await Result.tryPromise({
    try: () => fetchBranchHead(installationId, owner, name, sha),
    catch: (cause) => cause,
  });
  if (head.isErr()) return empty;
  return {
    message: head.value.message,
    authorName: head.value.authorName,
    authorAvatar: head.value.authorAvatar,
  };
}

export interface TriggerPreviewBuildInput {
  projectId: ProjectId;
  gitRepoId: GitRepoId;
  previewId: PreviewId;
  /** Head commit to build. */
  sha: string;
  /** Plain branch name (`feat/x`); qualified to `refs/heads/<branch>` here. */
  branch: string;
}

/** Insert preview-scoped pending deployments for the opted-in git services
 *  bound to this repo and enqueue a build. Returns how many were created. */
export async function triggerPreviewBuild(input: TriggerPreviewBuildInput): Promise<number> {
  // A preview rebuilds the PREVIEWS-ENABLED git-sourced BASE services bound to
  // this repo (preview-scoped resources are branches, not deploy targets).
  // Opt-in is per service; no watch-pattern filter, any commit refreshes the
  // whole preview.
  const resources = await db
    .select({ id: resource.id })
    .from(resource)
    .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .where(
      and(
        eq(resource.projectId, input.projectId),
        eq(resource.type, "service"),
        eq(serviceResource.source, "git"),
        eq(serviceResource.gitRepoId, input.gitRepoId),
        eq(serviceResource.previewsEnabled, true),
        isNull(resource.previewId),
      ),
    );
  if (resources.length === 0) return 0;

  // Dedupe: skip resources that already have an in-flight build for this exact
  // commit in this preview: N rapid Rebuild clicks shouldn't enqueue N
  // concurrent builds racing on the same swarm service.
  const inflight = await db
    .select({ resourceId: deployment.resourceId })
    .from(deployment)
    .where(
      and(
        eq(deployment.previewId, input.previewId),
        eq(deployment.gitSha, input.sha),
        inArray(deployment.status, ["pending", "building"]),
      ),
    );
  const busy = new Set(inflight.map((r) => r.resourceId));
  const pending = resources.filter((r) => !busy.has(r.id));
  if (pending.length === 0) return 0;

  const ref = `refs/heads/${input.branch}`;
  const provenance = await commitProvenance(input.gitRepoId, input.sha);
  const inserted = await db
    .insert(deployment)
    .values(
      pending.map((r) => ({
        resourceId: r.id,
        previewId: input.previewId,
        image: `pending:${input.sha.slice(0, 12)}`,
        reason: "git-push" as const,
        status: "pending" as const,
        gitSha: input.sha,
        gitRef: ref,
        gitCommitMessage: provenance.message,
        gitCommitAuthor: provenance.authorName,
        gitCommitAuthorAvatar: provenance.authorAvatar,
      })),
    )
    .returning({ id: deployment.id });

  for (let i = 0; i < inserted.length; i++) {
    const dep = inserted[i];
    const res = pending[i];
    if (dep && res) {
      await emitDeployStarted({ deploymentId: dep.id, resourceId: res.id, reason: "git-push" });
    }
  }

  // Per-service build servers mean one preview batch can span several lanes.
  const laneGroups = await groupDeploymentsByLane(
    input.projectId,
    inserted.flatMap((dep, i) => {
      const res = pending[i];
      return dep && res ? [{ deploymentId: dep.id, resourceId: res.id }] : [];
    }),
  );
  for (const [lane, deploymentIds] of laneGroups) {
    await triggerDeploy(
      {
        projectId: input.projectId,
        gitRepoId: input.gitRepoId,
        ref,
        sha: input.sha,
        previewId: input.previewId,
        deploymentIds,
      },
      undefined,
      lane,
    );
  }
  return inserted.length;
}
