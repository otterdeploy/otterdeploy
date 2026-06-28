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
import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { gitInstallation, gitRepo } from "@otterdeploy/db/schema/git";
import { deployment, project } from "@otterdeploy/db/schema/project";
import { triggerDeploy } from "@otterdeploy/jobs";
import { Result } from "better-result";
import { and, eq } from "drizzle-orm";

import { fetchBranchHeadSha } from "../../git/github-app";
import { emitDeployStarted } from "./deployments";

export async function enqueueGitBuild(args: {
  projectId: ProjectId;
  organizationId: OrganizationId;
  resourceId: ResourceId;
  log: RequestLogger;
}): Promise<Result<{ deploymentId: string }, string>> {
  const [proj] = await db
    .select({
      gitRepoId: project.gitRepoId,
      productionBranch: project.productionBranch,
      imageRepository: project.imageRepository,
      containerRegistryId: project.containerRegistryId,
    })
    .from(project)
    .where(and(eq(project.id, args.projectId), eq(project.organizationId, args.organizationId)))
    .limit(1);
  if (!proj?.gitRepoId) return Result.err("project has no git repo binding");
  // Registry binding is optional — the builder defaults to a registry-less
  // local image (built straight into the swarm node's daemon). Only an
  // external registry needs imageRepository + containerRegistryId, and the
  // builder resolves that itself; no gate here.

  const [repo] = await db
    .select({
      fullName: gitRepo.fullName,
      defaultBranch: gitRepo.defaultBranch,
      installationRowId: gitRepo.installationId,
    })
    .from(gitRepo)
    .where(eq(gitRepo.id, proj.gitRepoId))
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
    if (!inst) return Result.err("git installation not found");
    installationId = inst.installationId;
  }

  const branch = proj.productionBranch || repo.defaultBranch || "main";
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

  await triggerDeploy({
    projectId: args.projectId,
    gitRepoId: proj.gitRepoId,
    ref,
    sha,
    deploymentIds: [row.id],
  });
  args.log.set({ manifestBuild: { resourceId: args.resourceId, sha, ref } });
  return Result.ok({ deploymentId: row.id });
}
