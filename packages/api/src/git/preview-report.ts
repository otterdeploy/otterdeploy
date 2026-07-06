/**
 * Report preview state back to GitHub — the sticky status-table comment plus
 * the `otterdeploy/preview` commit status. Renders from a fresh DB snapshot on
 * every call, so any caller (PR webhook, build worker) converges the comment
 * to the truth rather than appending phase-specific text.
 *
 * Best-effort throughout: a GitHub API failure must never fail the webhook
 * (it returns 200 so GitHub stops retrying) or a build job, so everything is
 * wrapped and only logged on error.
 */
import type { DeploymentId, GitRepoId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deployment, environment } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { eq } from "drizzle-orm";
import { log } from "evlog";

import type { PreviewCommentRow } from "./preview-comment";
import type { PreviewReportSnapshot } from "./preview-report-state";

import { createCommitStatus, upsertPrComment } from "./github-app";
import { renderPreviewComment } from "./preview-comment";
import { loadPreviewReportSnapshot } from "./preview-report-state";

export interface ReportInput {
  gitRepoId: GitRepoId;
  prNumber: number;
  phase: "building" | "closed";
}

/** Roll the per-service states up into one commit-status verdict. */
function aggregateStatus(rows: PreviewCommentRow[]): {
  state: "pending" | "success" | "failure";
  description: string;
  targetUrl: string | null;
} {
  const failed = rows.find((r) => r.status === "failed");
  if (failed) {
    return {
      state: "failure",
      description: `Preview deployment failed (${failed.serviceName})`,
      targetUrl: failed.inspectUrl,
    };
  }
  const allReady = rows.length > 0 && rows.every((r) => r.status === "ready");
  if (allReady) {
    const ready = rows.find((r) => r.previewUrl) ?? rows[0];
    return {
      state: "success",
      description: "Preview deployment is ready",
      targetUrl: ready?.previewUrl ?? ready?.inspectUrl ?? null,
    };
  }
  return {
    state: "pending",
    description: "Preview is building…",
    targetUrl: rows.find((r) => r.inspectUrl)?.inspectUrl ?? null,
  };
}

async function syncComment(snapshot: PreviewReportSnapshot, tornDown: boolean): Promise<void> {
  const body = renderPreviewComment({
    prNumber: snapshot.prNumber,
    headSha: snapshot.headSha,
    rows: snapshot.rows,
    tornDown,
  });
  const comment = await Result.tryPromise({
    try: () =>
      upsertPrComment({
        // Both checked by the caller; TS can't see through the snapshot type.
        installationId: snapshot.installationId ?? "",
        owner: snapshot.owner ?? "",
        repo: snapshot.repo ?? "",
        prNumber: snapshot.prNumber,
        body,
      }),
    catch: (cause) => cause,
  });
  if (comment.isErr()) {
    log.warn({
      github: { event: "pull_request", step: "comment", prNumber: snapshot.prNumber },
      err: comment.error,
    });
  }
}

async function syncCommitStatus(snapshot: PreviewReportSnapshot): Promise<void> {
  if (!snapshot.headSha) return;
  const verdict = aggregateStatus(snapshot.rows);
  const status = await Result.tryPromise({
    try: () =>
      createCommitStatus({
        installationId: snapshot.installationId ?? "",
        owner: snapshot.owner ?? "",
        repo: snapshot.repo ?? "",
        sha: snapshot.headSha,
        state: verdict.state,
        description: verdict.description,
        targetUrl: verdict.targetUrl,
        context: "otterdeploy/preview",
      }),
    catch: (cause) => cause,
  });
  if (status.isErr()) {
    log.warn({
      github: { event: "pull_request", step: "status", prNumber: snapshot.prNumber },
      err: status.error,
    });
  }
}

export async function report(input: ReportInput): Promise<void> {
  const snapshot = await Result.tryPromise({
    try: () => loadPreviewReportSnapshot(input.gitRepoId, input.prNumber),
    catch: (cause) => cause,
  });
  if (snapshot.isErr()) {
    log.warn({
      github: { event: "pull_request", step: "report-load", prNumber: input.prNumber },
      err: snapshot.error,
    });
    return;
  }
  const state = snapshot.value;
  // Public repos have no installation and can't be written to via an App token.
  if (!state || !state.installationId || !state.owner || !state.repo) return;

  await syncComment(state, input.phase === "closed");
  // A closed PR keeps its last commit status — GitHub shows it against the
  // head commit, and flipping it on teardown would repaint merged PRs red.
  if (input.phase === "building") {
    await syncCommitStatus(state);
  }
}

/**
 * Build-worker hook: converge the PR comment + commit status after a
 * deployment reaches a terminal state. No-ops unless the deployment belongs
 * to a preview environment; never throws.
 */
export async function reportPreviewBuildOutcome(deploymentId: DeploymentId): Promise<void> {
  const outcome = await Result.tryPromise({
    try: async () => {
      const [dep] = await db
        .select({ environmentId: deployment.environmentId, gitSha: deployment.gitSha })
        .from(deployment)
        .where(eq(deployment.id, deploymentId))
        .limit(1);
      if (!dep?.environmentId) return;
      const [envRow] = await db
        .select()
        .from(environment)
        .where(eq(environment.id, dep.environmentId))
        .limit(1);
      if (
        envRow?.kind !== "preview" ||
        !envRow.gitRepoId ||
        envRow.pullRequestNumber == null
      ) {
        return;
      }
      // A push during the build superseded this deployment — the newer
      // build's own report owns the comment now.
      if (dep.gitSha && envRow.headSha && dep.gitSha !== envRow.headSha) return;
      await report({
        gitRepoId: envRow.gitRepoId,
        prNumber: envRow.pullRequestNumber,
        phase: "building",
      });
    },
    catch: (cause) => cause,
  });
  if (outcome.isErr()) {
    log.warn({ github: { step: "report-build-outcome", deploymentId }, err: outcome.error });
  }
}
