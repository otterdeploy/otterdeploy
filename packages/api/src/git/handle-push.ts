/**
 * `push` webhook — the load-bearing event. Looks up projects bound to the
 * repo whose productionBranch matches the pushed ref, inserts pending
 * Deployment rows for every service resource in each matched project,
 * then enqueues a `deploy.triggered` job per project.
 *
 * Build pipeline that consumes those Deployment rows lands in Phase 3.
 */

import { db } from "@otterdeploy/db";
import {
  deployment,
  gitRepo,
  project,
  resource,
  serviceResource,
} from "@otterdeploy/db/schema";
import { triggerDeploy } from "@otterdeploy/jobs";
import { ID_PREFIX, type Id } from "@otterdeploy/shared/id";
import { log } from "evlog";
import { and, eq } from "drizzle-orm";

import type { GithubWebhookResult, PushEvent } from "./types";

export async function handlePush(
  ev: PushEvent,
  deliveryId: string,
): Promise<GithubWebhookResult> {
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
  const repo = await db.query.gitRepo.findFirst({
    where: eq(gitRepo.providerRepoId, providerRepoId),
  });
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
  const branch = ev.ref.startsWith("refs/heads/")
    ? ev.ref.slice("refs/heads/".length)
    : ev.ref;

  const projects = await db.query.project.findMany({
    where: and(
      eq(project.gitRepoId, repo.id),
      eq(project.productionBranch, branch),
    ),
  });

  if (projects.length === 0) {
    return {
      kind: "push",
      ref: ev.ref,
      sha: ev.after,
      deploymentsCreated: 0,
      projectsTouched: 0,
    };
  }

  let deploymentsCreated = 0;
  for (const p of projects) {
    // Only services whose source is "git" rebuild on push. Image-sourced
    // services are pinned to whatever tag the operator chose at create
    // time; they redeploy only on explicit user action.
    const resources = await db
      .select({ id: resource.id })
      .from(resource)
      .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
      .where(
        and(
          eq(resource.projectId, p.id as Id<typeof ID_PREFIX.project>),
          eq(resource.type, "service"),
          eq(serviceResource.source, "git"),
        ),
      );
    if (resources.length === 0) continue;

    const inserted = await db
      .insert(deployment)
      .values(
        resources.map((r) => ({
          resourceId: r.id,
          // Image is rewritten by the build worker once it knows the
          // registry tag. Placeholder so the NOT NULL holds.
          image: `pending:${ev.after.slice(0, 12)}`,
          reason: "git-push" as const,
          status: "pending" as const,
          gitSha: ev.after,
          gitRef: ev.ref,
          gitCommitMessage: ev.head_commit?.message,
          gitCommitAuthor: ev.head_commit?.author?.name,
        })),
      )
      .returning({ id: deployment.id });

    deploymentsCreated += inserted.length;

    await triggerDeploy({
      projectId: p.id,
      gitRepoId: repo.id,
      ref: ev.ref,
      sha: ev.after,
      commitMessage: ev.head_commit?.message,
      commitAuthor: ev.head_commit?.author?.name,
      deploymentIds: inserted.map((d) => d.id),
    });
  }

  return {
    kind: "push",
    ref: ev.ref,
    sha: ev.after,
    deploymentsCreated,
    projectsTouched: projects.length,
  };
}
