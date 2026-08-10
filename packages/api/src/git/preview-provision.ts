/**
 * Provisioning ONE project's preview for a PR: cap check → preview row →
 * database branches → routes → build.
 *
 * Split out of handle-pull-request.ts, which owns the webhook's dispatch and
 * the cross-project tally. The seam is the project boundary: everything here
 * concerns a single project's preview and returns only what the caller needs to
 * add up.
 */

import type { GitRepoId, ProjectId } from "@otterdeploy/shared/id";

import { gitRepo, project } from "@otterdeploy/db/schema";
import { Result } from "better-result";
import { log } from "evlog";

import type { PullRequestEvent } from "./types";

import { checkPreviewCap, reportPreviewCapRefusal } from "./preview-cap";
import { branchProjectDatabases } from "./preview-db";
import { triggerPreviewBuild } from "./preview-deploy";
import { ensurePreview } from "./preview-env";
import { ensurePreviewRoutes } from "./preview-routes";

type ProjectRow = typeof project.$inferSelect;
type RepoRow = typeof gitRepo.$inferSelect;

/** What one project's preview attempt contributed to the webhook's tally. */
interface PreviewOutcome {
  touched: boolean;
  deployments: number;
  routesChanged: boolean;
}

const NO_PREVIEW: PreviewOutcome = { touched: false, deployments: 0, routesChanged: false };

function repoSlug(repo: RepoRow): string {
  return repo.fullName
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export async function deployPreviewForProject(
  p: ProjectRow,
  pr: PullRequestEvent["pull_request"],
  repo: RepoRow,
): Promise<PreviewOutcome> {
  // Checked BEFORE anything is created: the point of the cap is that no
  // container, route or database branch is provisioned once the project is
  // full. A push to an already-open PR always passes. See preview-cap.ts.
  const cap = await checkPreviewCap({
    projectId: p.id as ProjectId,
    gitRepoId: repo.id as GitRepoId,
    prNumber: pr.number,
  });
  if (!cap.allowed) {
    // Never a silent cap: the same rule idle GC follows. Somebody opened a
    // PR expecting a preview; they have to be able to find out why there
    // isn't one, and what to do about it.
    log.info({
      github: { event: "pull_request", step: "preview-cap", prNumber: pr.number },
      preview: { cap: cap.cap, active: cap.current, projectId: p.id },
      msg: "preview refused: project at its concurrent-preview limit",
    });
    await reportPreviewCapRefusal({
      gitRepoId: repo.id as GitRepoId,
      prNumber: pr.number,
      verdict: { cap: cap.cap, current: cap.current },
    });
    return NO_PREVIEW;
  }

  const row = await ensurePreview({
    projectId: p.id as ProjectId,
    gitRepoId: repo.id as GitRepoId,
    repoSlug: repoSlug(repo),
    prNumber: pr.number,
    prNodeId: pr.node_id ?? null,
    branch: pr.head.ref,
    headSha: pr.head.sha,
    prTitle: pr.title ?? null,
    prAuthorLogin: pr.user?.login ?? null,
    prAuthorAvatarUrl: pr.user?.avatar_url ?? null,
    prUrl: pr.html_url ?? null,
  });
  if (!row) return NO_PREVIEW;

  // Branch the project's OPT-IN databases into this preview BEFORE the
  // services deploy, so their ${{<db>.DATABASE_URL}} resolves to the
  // isolated branch. Databases without previewBranching are shared with the
  // base (the resolver falls back). Best-effort: a branch failure must not
  // strand the whole preview.
  const branched = await Result.tryPromise({
    try: () =>
      branchProjectDatabases({
        projectId: p.id as ProjectId,
        projectSlug: p.slug,
        previewId: row.id,
        previewSlug: row.slug,
        gitRepoId: repo.id as GitRepoId,
      }),
    catch: (cause) => cause,
  });
  if (branched.isErr()) {
    log.warn({
      github: { event: "pull_request", step: "branch-db", prNumber: pr.number },
      err: branched.error,
    });
  }

  // Mint the preview hosts up front: the container 502s until the build
  // converges, which the PR comment reflects as "Building". Best-effort:
  // a routing failure must not strand the build itself.
  const routes = await Result.tryPromise({
    try: () =>
      ensurePreviewRoutes({
        projectId: p.id as ProjectId,
        projectSlug: p.slug,
        gitRepoId: repo.id as GitRepoId,
        preview: { id: row.id, slug: row.slug, prNumber: row.prNumber },
      }),
    catch: (cause) => cause,
  });
  if (routes.isErr()) {
    log.warn({
      github: { event: "pull_request", step: "preview-routes", prNumber: pr.number },
      err: routes.error,
    });
  }

  const deployments = await triggerPreviewBuild({
    projectId: p.id as ProjectId,
    gitRepoId: repo.id as GitRepoId,
    previewId: row.id,
    sha: pr.head.sha,
    branch: pr.head.ref,
  });

  return {
    touched: true,
    deployments,
    routesChanged: routes.isOk() && Boolean(routes.value),
  };
}
