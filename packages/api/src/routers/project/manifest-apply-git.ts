/**
 * Git build enqueue (UI "Deploy" of a git-sourced service).
 *
 * The git-push webhook (git/handle-push.ts) is the only other place that kicks
 * a build; this is its UI-triggered twin. We resolve the head SHA of the
 * project's production branch ourselves (no push payload to read it from),
 * insert a pending deployment row keyed to the resource, and enqueue the build
 * job. Errors are returned as strings so the caller can fold them into
 * skipped[] without a typed-error taxonomy for every GitHub failure.
 */
import type { GitRepoId, OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { gitInstallation, gitProvider, gitRepo } from "@otterdeploy/db/schema/git";
import { deployment, serviceResource } from "@otterdeploy/db/schema/project";
import { triggerDeploy } from "@otterdeploy/jobs";
import { Result } from "better-result";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { type ServiceManifest } from "../../stack/manifest";

import { fetchBranchHeadSha } from "../../git/github-app";
import { inspectRepoTree } from "../git/inspect";
import { emitDeployStarted } from "./deployments";
import { publishResourceChanged } from "./project-event-bus";

export async function enqueueGitBuild(args: {
  projectId: ProjectId;
  organizationId: OrganizationId;
  resourceId: ResourceId;
  log: RequestLogger;
}): Promise<Result<{ deploymentId: string }, string>> {
  // Git binding lives on the SERVICE now — its own repo + branch, not the
  // project's. Registry/image are optional (the builder resolves them itself,
  // defaulting to a registry-less local image), so only the repo gates here.
  const [svc] = await db
    .select({ gitRepoId: serviceResource.gitRepoId, branch: serviceResource.branch })
    .from(serviceResource)
    .where(eq(serviceResource.resourceId, args.resourceId))
    .limit(1);
  if (!svc?.gitRepoId) return Result.err("service has no git repo binding");
  const gitRepoId = svc.gitRepoId;

  const [repo] = await db
    .select({
      fullName: gitRepo.fullName,
      defaultBranch: gitRepo.defaultBranch,
      installationRowId: gitRepo.installationId,
    })
    .from(gitRepo)
    .where(eq(gitRepo.id, svc.gitRepoId))
    .limit(1);
  if (!repo) return Result.err("git repo not found");

  // Resolve an installation token only when the repo is linked to one.
  // With no installation we build anonymously — the head-SHA lookup below
  // and the builder's clone both fall back to unauthenticated access, which
  // works for public repos. A genuinely private repo with no installation
  // fails the SHA lookup with a clear 404 below; we deliberately don't
  // pre-judge on the `is_private` flag, which defaults to true and is often
  // stale/wrong (a public repo can be recorded as private).
  let installationId: string | null = null;
  if (repo.installationRowId) {
    const [inst] = await db
      .select({ installationId: gitInstallation.installationId })
      .from(gitInstallation)
      .where(eq(gitInstallation.id, repo.installationRowId))
      .limit(1);
    // A missing install row means the GitHub App was removed/reconnected and
    // orphaned this FK. Don't hard-fail — fall back to anonymous access, which
    // builds a public repo fine; a genuinely private repo just fails the SHA
    // lookup below with a clear 404 (same as an unlinked private repo). Mirrors
    // the builder's `load.ts`, which only requires the install for private repos.
    if (inst) installationId = inst.installationId;
  }

  const branch = svc.branch || repo.defaultBranch || "main";
  const [owner, repoName] = repo.fullName.split("/");
  if (!owner || !repoName) {
    return Result.err(`unexpected repo full name: ${repo.fullName}`);
  }

  // fetchBranchHeadSha throws on failure (github-app.ts idiom); wrap it so
  // GitHub/network errors fold into skipped[] rather than aborting apply.
  const shaResult = await Result.tryPromise({
    try: () => fetchBranchHeadSha(installationId, owner, repoName, branch),
    catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
  });
  if (shaResult.isErr()) {
    return Result.err(`could not resolve ${branch} head: ${shaResult.error}`);
  }
  const sha = shaResult.value;

  const ref = `refs/heads/${branch}`;

  // Dedup guard: don't stack a duplicate build behind an identical in-flight
  // one. If a deployment for this resource at this exact SHA is already
  // pending/building, reuse it — creating a second row only strands it (the
  // builder no-ops the redundant SHA, leaving a phantom `pending` with no
  // logs). Idempotent: repeated applies converge on the one live deployment.
  const [inflight] = await db
    .select({ id: deployment.id })
    .from(deployment)
    .where(
      and(
        eq(deployment.resourceId, args.resourceId),
        eq(deployment.gitSha, sha),
        inArray(deployment.status, ["pending", "building"]),
      ),
    )
    .limit(1);
  if (inflight) {
    args.log.set({ manifestBuild: { resourceId: args.resourceId, sha, ref, reused: inflight.id } });
    return Result.ok({ deploymentId: inflight.id });
  }

  const [row] = await db
    .insert(deployment)
    .values({
      resourceId: args.resourceId,
      // Rewritten to the real registry tag by the builder once known.
      image: `pending:${sha.slice(0, 12)}`,
      reason: "create" as const,
      status: "pending" as const,
      gitSha: sha,
      gitRef: ref,
    })
    .returning({ id: deployment.id });
  if (!row) return Result.err("failed to insert deployment row");

  await emitDeployStarted({
    deploymentId: row.id,
    resourceId: args.resourceId,
    reason: "create",
  });
  // Push the pending build to the stream so the node shows progress at once.
  void publishResourceChanged(args.resourceId);
  // Surface the framework brand mark right away — the builder only persists the
  // framework after a *successful* build, so a service that never built (or
  // failed) would otherwise sit on the generic kind icon forever. Best-effort +
  // non-blocking; a repo we can't read just keeps whatever framework it had.
  void detectAndPersistFramework(svc.gitRepoId, args.resourceId).catch(() => undefined);

  // Enqueue AFTER the row insert — so a Redis/queue outage here must mark the
  // row failed, or it strands as a `pending` deployment no job will ever own
  // (a 500 to the user and a forever-pending badge). Same string-error channel
  // as the SHA lookup so apply folds it into skipped[].
  const enqueueResult = await Result.tryPromise({
    try: () =>
      triggerDeploy({
        projectId: args.projectId,
        gitRepoId,
        ref,
        sha,
        deploymentIds: [row.id],
      }),
    catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
  });
  if (enqueueResult.isErr()) {
    const message = `could not queue the build (is Redis/the builder running?): ${enqueueResult.error}`;
    const { markDeploymentFailed } = await import("./deployments");
    await markDeploymentFailed(row.id, message).catch(() => undefined);
    return Result.err(message);
  }
  args.log.set({ manifestBuild: { resourceId: args.resourceId, sha, ref } });
  return Result.ok({ deploymentId: row.id });
}

/**
 * Detect the service's framework from its repo tree and persist it to the
 * resource row so the graph node + drawer render the right brand mark (Next.js,
 * Vite, …) immediately — independent of whether a build ever succeeds. The
 * builder re-captures this post-build; this just makes the icon correct up
 * front. Reuses the same `inspectRepoTree` detector the create wizard uses.
 *
 * Best-effort by design: it reads over the GitHub API (which can fail for a
 * private repo we can't authenticate, or a transient error), so any failure
 * leaves the framework untouched. Never gates the deploy — the caller fires it
 * and forgets it.
 */
export async function detectAndPersistFramework(
  gitRepoId: string,
  resourceId: ResourceId,
): Promise<void> {
  const [svc] = await db
    .select({ sourceSubdir: serviceResource.sourceSubdir, current: serviceResource.framework })
    .from(serviceResource)
    .where(eq(serviceResource.resourceId, resourceId))
    .limit(1);
  if (!svc) return;

  const inspected = await inspectRepoTree({ gitRepoId, path: svc.sourceSubdir ?? "" });
  if (inspected.isErr()) return;

  const framework = inspected.value.framework;
  if (!framework || framework === svc.current) return;

  await db
    .update(serviceResource)
    .set({ framework })
    .where(eq(serviceResource.resourceId, resourceId));
  void publishResourceChanged(resourceId);
}

/**
 * Resolve a manifest's portable `owner/repo` to the internal git_repo row id,
 * scoped to the org. Prefers an installation-backed row the org owns; falls
 * back to a public (installationId-null, tenant-shared) row. Returns null when
 * the repo isn't connected — the service still stages, and its build fails with
 * a clear "no git repo binding" until the operator connects/picks the repo.
 * Org-scoped: prefer an installation-backed row this org owns, else a public one.
 */
export async function resolveManifestRepo(
  repo: string | undefined,
  organizationId: OrganizationId,
): Promise<GitRepoId | null> {
  if (!repo) return null;
  const [owned] = await db
    .select({ id: gitRepo.id })
    .from(gitRepo)
    .innerJoin(gitInstallation, eq(gitInstallation.id, gitRepo.installationId))
    .innerJoin(gitProvider, eq(gitProvider.id, gitInstallation.providerId))
    .where(and(eq(gitRepo.fullName, repo), eq(gitProvider.organizationId, organizationId)))
    .limit(1);
  if (owned) return owned.id;
  const [pub] = await db
    .select({ id: gitRepo.id })
    .from(gitRepo)
    .where(and(eq(gitRepo.fullName, repo), isNull(gitRepo.installationId)))
    .limit(1);
  return pub?.id ?? null;
}

/** Pull the git-only source fields off a manifest service (repo resolved to an
 *  id upstream). Empty for an image service — those columns stay null. */
export function gitSourceColumns(spec: ServiceManifest, gitRepoId: GitRepoId | null) {
  if (spec.source !== "git") {
    return { gitRepoId: null, branch: null, imageRepository: null, previewsEnabled: false };
  }
  return {
    gitRepoId,
    branch: spec.branch ?? null,
    imageRepository: spec.imageRepository ?? null,
    // Fresh create: no live toggle to preserve, so an omitted key is plain off.
    previewsEnabled: spec.previews ?? false,
  };
}
