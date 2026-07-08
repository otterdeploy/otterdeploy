/**
 * Env-scoped deployment fan-out for one project's preview — split out of
 * handle-pull-request.ts to keep the orchestrator under the file-length gate
 * (same reason preview-report.ts is separate).
 */
import type { PreviewId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deployment, gitRepo, project, resource, serviceResource } from "@otterdeploy/db/schema";
import { triggerDeploy } from "@otterdeploy/jobs";
import { and, eq, isNull } from "drizzle-orm";

import type { PullRequestEvent } from "./types";

import { emitDeployStarted } from "../routers/project/deployments";

type ProjectRow = typeof project.$inferSelect;
type RepoRow = typeof gitRepo.$inferSelect;

/** Insert env-scoped pending deployments for a project's git services and
 *  trigger a build at the PR head. Returns how many deployments were created. */
export async function deployProjectPreview(
  p: ProjectRow,
  repo: RepoRow,
  ev: PullRequestEvent,
  previewId: PreviewId,
): Promise<number> {
  const pr = ev.pull_request;
  // A preview rebuilds the PREVIEWS-ENABLED git-sourced BASE services bound
  // to this repo (env-scoped resources are branches, not deploy targets).
  // Opt-in is per service — a sibling service on the same repo that didn't
  // opt in stays out of the preview entirely. No watch-pattern filter — any
  // PR commit refreshes the whole preview.
  const resources = await db
    .select({ id: resource.id })
    .from(resource)
    .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .where(
      and(
        eq(resource.projectId, p.id as ProjectId),
        eq(resource.type, "service"),
        eq(serviceResource.source, "git"),
        eq(serviceResource.gitRepoId, repo.id),
        eq(serviceResource.previewsEnabled, true),
        isNull(resource.previewId),
      ),
    );
  if (resources.length === 0) return 0;

  const ref = `refs/heads/${pr.head.ref}`;
  const inserted = await db
    .insert(deployment)
    .values(
      resources.map((r) => ({
        resourceId: r.id,
        previewId,
        image: `pending:${pr.head.sha.slice(0, 12)}`,
        reason: "git-push" as const,
        status: "pending" as const,
        gitSha: pr.head.sha,
        gitRef: ref,
      })),
    )
    .returning({ id: deployment.id });

  for (let i = 0; i < inserted.length; i++) {
    const dep = inserted[i];
    const res = resources[i];
    if (dep && res) {
      await emitDeployStarted({ deploymentId: dep.id, resourceId: res.id, reason: "git-push" });
    }
  }

  await triggerDeploy({
    projectId: p.id,
    gitRepoId: repo.id,
    ref,
    sha: pr.head.sha,
    previewId,
    deploymentIds: inserted.map((d) => d.id),
  });
  return inserted.length;
}
