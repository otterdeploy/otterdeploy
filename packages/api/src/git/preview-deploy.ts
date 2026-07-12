/**
 * Preview build trigger — insert preview-scoped pending deployments for a
 * project's opted-in git services and enqueue a build at a given commit.
 * Shared by the PR webhook (opened/synchronize) and the manual
 * `previews.rebuild` control.
 */
import type { GitRepoId, PreviewId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deployment, resource, serviceResource } from "@otterdeploy/db/schema";
import { triggerDeploy } from "@otterdeploy/jobs";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { emitDeployStarted } from "../routers/project/deployments";

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
  // Opt-in is per service; no watch-pattern filter — any commit refreshes the
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
  // commit in this preview — N rapid Rebuild clicks shouldn't enqueue N
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

  await triggerDeploy({
    projectId: input.projectId,
    gitRepoId: input.gitRepoId,
    ref,
    sha: input.sha,
    previewId: input.previewId,
    deploymentIds: inserted.map((d) => d.id),
  });
  return inserted.length;
}
