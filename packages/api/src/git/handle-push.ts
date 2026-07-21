/**
 * `push` webhook — the load-bearing event. Looks up projects bound to the
 * repo whose productionBranch matches the pushed ref, inserts pending
 * Deployment rows for every service resource in each matched project,
 * then enqueues a `deploy.triggered` job per project.
 *
 * Build pipeline that consumes those Deployment rows lands in Phase 3.
 */

import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deployment, gitRepo, resource, serviceResource } from "@otterdeploy/db/schema";
import { triggerDeploy } from "@otterdeploy/jobs";
import { Result } from "better-result";
import { and, eq, isNull, or } from "drizzle-orm";
import { log } from "evlog";

import type { GithubWebhookResult, PushEvent } from "./types";

import { emitDeployStarted, markDeploymentFailed } from "../routers/project/deployments";
import { detectAndPersistFramework } from "../routers/project/manifest-apply-git";
import { changedPathsFromPush, matchesWatchPatterns } from "./watch-match";

export async function handlePush(ev: PushEvent, deliveryId: string): Promise<GithubWebhookResult> {
  if (ev.deleted) {
    return {
      kind: "push",
      ref: ev.ref,
      sha: ev.after,
      deploymentsCreated: 0,
      projectsTouched: 0,
    };
  }

  const providerRepoId = String(ev.repository.node_id ?? ev.repository.id);
  const [repo] = await db
    .select()
    .from(gitRepo)
    .where(eq(gitRepo.providerRepoId, providerRepoId))
    .limit(1);
  if (!repo) {
    log.info({
      github: {
        event: "push",
        deliveryId,
        repo: ev.repository.full_name,
        ref: ev.ref,
      },
      msg: "push for unknown repo — not bound to any project",
    });
    return {
      kind: "push",
      ref: ev.ref,
      sha: ev.after,
      deploymentsCreated: 0,
      projectsTouched: 0,
    };
  }

  // `refs/heads/main` → `main`.
  const branch = ev.ref.startsWith("refs/heads/") ? ev.ref.slice("refs/heads/".length) : ev.ref;

  // Repo binding lives on the SERVICE now: a push fans out to exactly the git
  // services bound to THIS (repo, branch) — possibly across several projects,
  // and NOT every service in a project. A service with a null branch tracks the
  // repo's default branch. Compose member services (stackId set) reconcile via
  // their stack, not here.
  const matchesDefaultBranch = branch === repo.defaultBranch;
  const candidates = await db
    .select({
      resourceId: resource.id,
      projectId: resource.projectId,
      buildConfig: serviceResource.buildConfig,
    })
    .from(serviceResource)
    .innerJoin(resource, eq(resource.id, serviceResource.resourceId))
    .where(
      and(
        eq(serviceResource.gitRepoId, repo.id),
        eq(resource.type, "service"),
        isNull(serviceResource.stackId),
        matchesDefaultBranch
          ? or(eq(serviceResource.branch, branch), isNull(serviceResource.branch))
          : eq(serviceResource.branch, branch),
      ),
    );

  if (candidates.length === 0) {
    return { kind: "push", ref: ev.ref, sha: ev.after, deploymentsCreated: 0, projectsTouched: 0 };
  }

  // Globs are matched against the paths this push touched. Computed once —
  // it's the same set for every candidate service.
  const changedPaths = changedPathsFromPush(ev);

  // Watch-pattern filter (unset patterns / unknown change set → rebuild), then
  // group survivors by project so each project gets one triggerDeploy carrying
  // all of its affected services.
  const byProject = new Map<ProjectId, ResourceId[]>();
  for (const c of candidates) {
    if (!matchesWatchPatterns(changedPaths, c.buildConfig?.watchPatterns)) continue;
    const list = byProject.get(c.projectId) ?? [];
    list.push(c.resourceId);
    byProject.set(c.projectId, list);
  }

  const deploymentsCreated = await fanOutDeploys(byProject, repo.id, ev);

  return {
    kind: "push",
    ref: ev.ref,
    sha: ev.after,
    deploymentsCreated,
    projectsTouched: byProject.size,
  };
}

/**
 * Insert pending deployment rows for each matched service, emit deploy.started,
 * kick off the framework brand-mark refresh, and enqueue one build job per
 * project. Returns the total number of deployments created.
 */
async function fanOutDeploys(
  byProject: Map<ProjectId, ResourceId[]>,
  gitRepoId: string,
  ev: PushEvent,
): Promise<number> {
  let created = 0;
  for (const [projectId, resourceIds] of byProject) {
    const inserted = await db
      .insert(deployment)
      .values(
        resourceIds.map((resourceId) => ({
          resourceId,
          // Image is rewritten by the build worker once it knows the
          // registry tag. Placeholder so the NOT NULL holds.
          image: `pending:${ev.after.slice(0, 12)}`,
          reason: "git-push" as const,
          status: "pending" as const,
          gitSha: ev.after,
          gitRef: ev.ref,
          gitCommitMessage: ev.head_commit?.message,
          gitCommitAuthor: ev.head_commit?.author?.name,
          gitCommitAuthorAvatar: ev.sender?.avatar_url ?? null,
        })),
      )
      .returning({ id: deployment.id });

    created += inserted.length;

    // deploy.started per service (inserted is index-aligned with resourceIds).
    for (let i = 0; i < inserted.length; i++) {
      const dep = inserted[i];
      const resourceId = resourceIds[i];
      if (dep && resourceId) {
        await emitDeployStarted({ deploymentId: dep.id, resourceId, reason: "git-push" });
        // Refresh the framework brand mark on push too (best-effort, non-blocking)
        // — matches the UI Deploy path so a push updates the icon without waiting
        // for a successful build.
        void detectAndPersistFramework(gitRepoId, resourceId).catch(() => undefined);
      }
    }

    // Same insert-then-enqueue hazard as enqueueGitBuild: if the queue is down
    // the rows just inserted would strand as `pending` forever (no job ever
    // owns them). Mark them failed so the UI + notifications say what happened.
    const enqueued = await Result.tryPromise({
      try: () =>
        triggerDeploy({
          projectId,
          gitRepoId,
          ref: ev.ref,
          sha: ev.after,
          commitMessage: ev.head_commit?.message,
          commitAuthor: ev.head_commit?.author?.name,
          deploymentIds: inserted.map((d) => d.id),
        }),
      catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
    });
    if (enqueued.isErr()) {
      const message = `could not queue the build (is Redis/the builder running?): ${enqueued.error}`;
      for (const dep of inserted) {
        await markDeploymentFailed(dep.id, message).catch(() => undefined);
      }
    }
  }
  return created;
}
