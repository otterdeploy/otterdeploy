/**
 * `pull_request` webhook — drives preview environments (docs/designs/pr-previews.md §7).
 *
 * opened / reopened / synchronize → ensure the PR's preview environment, insert
 * env-scoped pending deployments for every git-sourced service, trigger a build
 * at the PR head, and report a pending status + sticky comment on the PR.
 * closed → mark the preview env(s) closed and report teardown.
 *
 * This owns the DB-level orchestration + GitHub reporting. Two infra steps are
 * INVOKED FROM HERE but wired in follow-ups, and are called out inline:
 *   - DB branching: the P2 engine (runtime().branchDatabase) exists; constructing
 *     each branch's spec (fresh creds/hostname/volume) is the remaining glue.
 *   - Runtime teardown + env-scoped build: the builder must thread environmentId
 *     (payload already carries it) so previews deploy under `<svc>-pr-<n>`; until
 *     then there are no preview containers to tear down.
 */

import type { EnvironmentId, GitRepoId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deployment, gitRepo, project, resource, serviceResource } from "@otterdeploy/db/schema";
import { triggerDeploy } from "@otterdeploy/jobs";
import { Result } from "better-result";
import { and, eq, isNull } from "drizzle-orm";
import { log } from "evlog";

import type { GithubWebhookResult, PullRequestEvent } from "./types";

import { emitDeployStarted } from "../routers/project/deployments";
import { createCommitStatus, upsertPrComment } from "./github-app";
import { ensurePreviewEnvironment, markPreviewEnvironmentsClosed } from "./preview-env";
import { branchProjectDatabases } from "./preview-db";

const PREVIEW_ACTIONS = new Set(["opened", "reopened", "synchronize"]);

type ProjectRow = typeof project.$inferSelect;
type RepoRow = typeof gitRepo.$inferSelect;

export async function handlePullRequest(
  ev: PullRequestEvent,
  deliveryId: string,
): Promise<GithubWebhookResult> {
  const { action } = ev;
  const prNumber = ev.pull_request.number;
  const ignored: GithubWebhookResult = {
    kind: "pull_request",
    action,
    prNumber,
    outcome: "ignored",
    environmentsTouched: 0,
    deploymentsCreated: 0,
  };

  if (action !== "closed" && !PREVIEW_ACTIONS.has(action)) return ignored;

  const providerRepoId = String(ev.repository.node_id ?? ev.repository.id);
  const [repo] = await db
    .select()
    .from(gitRepo)
    .where(eq(gitRepo.providerRepoId, providerRepoId))
    .limit(1);
  if (!repo) {
    log.info({
      github: { event: "pull_request", deliveryId, repo: ev.repository.full_name, action },
      msg: "pull_request for unknown repo — not bound to any project",
    });
    return ignored;
  }

  const projects = await db.select().from(project).where(eq(project.gitRepoId, repo.id));
  if (projects.length === 0) return ignored;

  return action === "closed"
    ? closePreviews(ev, repo, projects)
    : deployPreviews(ev, repo, projects);
}

/** Owner/repo/installation context for reporting back to GitHub. */
function reportContext(ev: PullRequestEvent, repo: RepoRow) {
  const [owner, repoName] = repo.fullName.split("/");
  return {
    installationId: ev.installation ? String(ev.installation.id) : null,
    owner,
    repo: repoName,
    prNumber: ev.pull_request.number,
    sha: ev.pull_request.head.sha,
  };
}

async function closePreviews(
  ev: PullRequestEvent,
  repo: RepoRow,
  projects: ProjectRow[],
): Promise<GithubWebhookResult> {
  const prNumber = ev.pull_request.number;
  let environmentsTouched = 0;
  for (const p of projects) {
    const closed = await markPreviewEnvironmentsClosed(p.id as ProjectId, prNumber);
    environmentsTouched += closed.length;
    // TODO(activation): destroy each closed env's preview containers + branched
    // DBs (runtime().destroy / destroyDatabaseBranch). No-op today since nothing
    // deploys env-scoped until the builder threads environmentId.
  }
  if (environmentsTouched > 0) {
    await report({ ...reportContext(ev, repo), phase: "closed" });
  }
  return {
    kind: "pull_request",
    action: ev.action,
    prNumber,
    outcome: "preview-closed",
    environmentsTouched,
    deploymentsCreated: 0,
  };
}

async function deployPreviews(
  ev: PullRequestEvent,
  repo: RepoRow,
  projects: ProjectRow[],
): Promise<GithubWebhookResult> {
  const pr = ev.pull_request;
  let deploymentsCreated = 0;
  let environmentsTouched = 0;
  for (const p of projects) {
    const env = await ensurePreviewEnvironment({
      projectId: p.id as ProjectId,
      baseEnvironmentId: p.environmentId ?? null,
      gitRepoId: repo.id as GitRepoId,
      prNumber: pr.number,
      prNodeId: pr.node_id ?? null,
      headRef: pr.head.ref,
      headSha: pr.head.sha,
    });
    if (!env) continue;
    environmentsTouched++;
    // Branch the project's databases into this preview env BEFORE the services
    // deploy, so their ${{<db>.DATABASE_URL}} resolves to the isolated branch.
    // Best-effort: a branch failure must not strand the whole preview.
    const branched = await Result.tryPromise({
      try: () =>
        branchProjectDatabases({
          projectId: p.id as ProjectId,
          projectSlug: p.slug,
          environmentId: env.id as EnvironmentId,
          previewSlug: `pr-${pr.number}`,
        }),
      catch: (cause) => cause,
    });
    if (branched.isErr()) {
      log.warn({ github: { event: "pull_request", step: "branch-db", prNumber: pr.number }, err: branched.error });
    }
    deploymentsCreated += await deployProjectPreview(p, repo, ev, env.id as EnvironmentId);
  }

  if (environmentsTouched > 0) {
    await report({ ...reportContext(ev, repo), phase: "building" });
  }
  return {
    kind: "pull_request",
    action: ev.action,
    prNumber: pr.number,
    outcome: "preview-deployed",
    environmentsTouched,
    deploymentsCreated,
  };
}

/** Insert env-scoped pending deployments for a project's git services and
 *  trigger a build at the PR head. Returns how many deployments were created. */
async function deployProjectPreview(
  p: ProjectRow,
  repo: RepoRow,
  ev: PullRequestEvent,
  environmentId: EnvironmentId,
): Promise<number> {
  const pr = ev.pull_request;
  // A preview rebuilds every git-sourced BASE service (env-scoped resources are
  // branches, not deploy targets). No watch-pattern filter — any PR commit
  // refreshes the whole preview.
  const resources = await db
    .select({ id: resource.id })
    .from(resource)
    .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .where(
      and(
        eq(resource.projectId, p.id as ProjectId),
        eq(resource.type, "service"),
        eq(serviceResource.source, "git"),
        isNull(resource.environmentId),
      ),
    );
  if (resources.length === 0) return 0;

  const ref = `refs/heads/${pr.head.ref}`;
  const inserted = await db
    .insert(deployment)
    .values(
      resources.map((r) => ({
        resourceId: r.id,
        environmentId,
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
    environmentId,
    deploymentIds: inserted.map((d) => d.id),
  });
  return inserted.length;
}

/**
 * Report preview state back to GitHub — best-effort: a GitHub API failure must
 * never fail the webhook (it returns 200 so GitHub stops retrying), so each call
 * is wrapped and only logged on error.
 */
async function report(input: {
  installationId: string | null;
  owner: string | undefined;
  repo: string | undefined;
  prNumber: number;
  sha: string;
  phase: "building" | "closed";
}): Promise<void> {
  const { installationId, owner, repo, prNumber, sha, phase } = input;
  // Public repos have no installation and can't be written to via an App token.
  if (!installationId || !owner || !repo) return;

  const body =
    phase === "building"
      ? `**Preview environment** for PR #${prNumber} is building… otterdeploy will update this comment when it's live.`
      : `**Preview environment** for PR #${prNumber} has been torn down.`;

  const comment = await Result.tryPromise({
    try: () => upsertPrComment({ installationId, owner, repo, prNumber, body }),
    catch: (cause) => cause,
  });
  if (comment.isErr()) {
    log.warn({ github: { event: "pull_request", step: "comment", prNumber }, err: comment.error });
  }

  if (phase === "building") {
    const status = await Result.tryPromise({
      try: () =>
        createCommitStatus({
          installationId,
          owner,
          repo,
          sha,
          state: "pending",
          description: "Preview building…",
          context: "otterdeploy/preview",
        }),
      catch: (cause) => cause,
    });
    if (status.isErr()) {
      log.warn({ github: { event: "pull_request", step: "status", prNumber }, err: status.error });
    }
  }
}
