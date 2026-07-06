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
import { and, eq, inArray, isNull } from "drizzle-orm";
import { log } from "evlog";

import type { GithubWebhookResult, PullRequestEvent } from "./types";

import { reconcile } from "../caddy";
import { emitDeployStarted } from "../routers/project/deployments";
import { branchProjectDatabases } from "./preview-db";
import { ensurePreviewEnvironment, markPreviewEnvironmentsClosed } from "./preview-env";
import { report } from "./preview-report";
import { ensurePreviewRoutes } from "./preview-routes";
import { teardownPreviewEnvironment } from "./preview-teardown";

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

  // Repo binding lives on services now — find the projects that own at least
  // one git service bound to this repo (a PR on repo A only concerns services
  // built from repo A, even if the project also hosts repo-B services).
  const projectIdRows = await db
    .selectDistinct({ id: resource.projectId })
    .from(serviceResource)
    .innerJoin(resource, eq(resource.id, serviceResource.resourceId))
    .where(and(eq(serviceResource.gitRepoId, repo.id), isNull(serviceResource.stackId)));
  if (projectIdRows.length === 0) return ignored;
  const projects = await db
    .select()
    .from(project)
    .where(
      inArray(
        project.id,
        projectIdRows.map((r) => r.id),
      ),
    );
  if (projects.length === 0) return ignored;

  // Close/teardown is NEVER gated: a project that turned previews OFF after a
  // preview was already running must still have it torn down on PR close, or
  // the containers + branched DBs leak.
  if (action === "closed") return closePreviews(ev, repo, projects);

  // Deploy is OPT-IN: only projects that explicitly enabled preview deployments
  // spin one up. Everything else is ignored — no env, no build, no container.
  const optedIn = projects.filter((p) => p.previewsEnabled);
  if (optedIn.length === 0) {
    log.info({
      github: { event: "pull_request", deliveryId, repo: ev.repository.full_name, action },
      msg: "preview deployments not enabled for any bound project — ignoring",
    });
    return ignored;
  }
  return deployPreviews(ev, repo, optedIn);
}

/** Sanitized `owner-repo` slug — qualifies preview env slugs/DB branch names so
 *  two repos in one project never collide on the same PR number. */
function repoSlug(repo: RepoRow): string {
  return repo.fullName
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

async function closePreviews(
  ev: PullRequestEvent,
  repo: RepoRow,
  projects: ProjectRow[],
): Promise<GithubWebhookResult> {
  const prNumber = ev.pull_request.number;
  let environmentsTouched = 0;
  for (const p of projects) {
    const closed = await markPreviewEnvironmentsClosed(
      p.id as ProjectId,
      repo.id as GitRepoId,
      prNumber,
    );
    environmentsTouched += closed.length;
    // Destroy each closed env's preview containers + branched databases.
    for (const env of closed) {
      await teardownPreviewEnvironment({
        id: env.id,
        projectId: p.id as ProjectId,
        projectSlug: p.slug,
        slug: env.slug,
        pullRequestNumber: env.pullRequestNumber,
      });
    }
  }
  if (environmentsTouched > 0) {
    await report({ gitRepoId: repo.id as GitRepoId, prNumber, phase: "closed" });
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
  let routesChanged = false;
  for (const p of projects) {
    const env = await ensurePreviewEnvironment({
      projectId: p.id as ProjectId,
      baseEnvironmentId: p.environmentId ?? null,
      gitRepoId: repo.id as GitRepoId,
      repoSlug: repoSlug(repo),
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
          previewSlug: `${repoSlug(repo)}-pr-${pr.number}`,
        }),
      catch: (cause) => cause,
    });
    if (branched.isErr()) {
      log.warn({
        github: { event: "pull_request", step: "branch-db", prNumber: pr.number },
        err: branched.error,
      });
    }
    // Mint the preview hosts up front — the container 502s until the build
    // converges, which the PR comment reflects as "Building". Best-effort:
    // a routing failure must not strand the build itself.
    const routes = await Result.tryPromise({
      try: () =>
        ensurePreviewRoutes({
          projectId: p.id as ProjectId,
          projectSlug: p.slug,
          gitRepoId: repo.id as GitRepoId,
          env: {
            id: env.id as EnvironmentId,
            kind: "preview",
            slug: env.slug,
            pullRequestNumber: env.pullRequestNumber,
          },
        }),
      catch: (cause) => cause,
    });
    if (routes.isErr()) {
      log.warn({
        github: { event: "pull_request", step: "preview-routes", prNumber: pr.number },
        err: routes.error,
      });
    } else if (routes.value) {
      routesChanged = true;
    }
    deploymentsCreated += await deployProjectPreview(p, repo, ev, env.id as EnvironmentId);
  }

  if (routesChanged) {
    const reconciled = await Result.tryPromise({ try: () => reconcile(), catch: (cause) => cause });
    if (reconciled.isErr()) {
      log.warn({
        github: { event: "pull_request", step: "reconcile-routes", prNumber: pr.number },
        err: reconciled.error,
      });
    }
  }
  if (environmentsTouched > 0) {
    await report({ gitRepoId: repo.id as GitRepoId, prNumber: pr.number, phase: "building" });
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
  // A preview rebuilds the git-sourced BASE services BOUND TO THIS REPO
  // (env-scoped resources are branches, not deploy targets). Only this repo's
  // services — a project may host services from other repos untouched by this
  // PR. No watch-pattern filter — any PR commit refreshes the whole preview.
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
