import type { GitRepoId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deployment } from "@otterdeploy/db/schema/project";
import { triggerDeploy } from "@otterdeploy/jobs";
/**
 * Hand a git-sourced compose stack to the build worker. Kept out of the oRPC
 * handlers (`index.ts`) because it's a distinct concern: resolve the branch
 * head, open a deployment, and enqueue — the builder then clones, builds any
 * `build:` services, fetches + persists the compose file, and deploys.
 */
import { Result } from "better-result";

import { fetchBranchHeadSha } from "../../git/github-app";
import { resolveRepoCloneBinding } from "../../git/repo-binding";
import { parseGitHubUrl } from "./util";

/**
 * Enqueue a build for a git-sourced stack: resolve the branch head SHA (unless
 * the caller pre-resolved it for fail-fast), open a pending deployment row, and
 * trigger the build. Shared by git-create and git-redeploy so a git stack
 * ALWAYS deploys through the builder — never off stale/absent persisted content
 * (a direct `deployCompose` on an unbuilt git stack would throw on empty
 * content).
 */
export async function enqueueComposeBuild(input: {
  projectId: ProjectId;
  resourceId: ResourceId;
  gitRepoUrl: string;
  /** Full ref, e.g. `refs/heads/main`. */
  gitRef: string;
  /** The compose row's bound repo id, if any. Drives AUTHENTICATED head-SHA
   *  resolution (private repos) and is the deploy job's correlation id (falls
   *  back to the stack resource id). Null for legacy public-URL stacks. */
  gitRepoId: GitRepoId | null;
  reason: "create" | "redeploy";
  /** Pre-resolved head SHA (create resolves it before inserting the row, to
   *  fail fast on a bad branch); omitted on redeploy so we resolve it here. */
  sha?: string;
}): Promise<Result<{ sha: string }, string>> {
  let sha = input.sha;
  if (!sha) {
    const branch = input.gitRef.replace(/^refs\/heads\//, "") || "main";
    // Bound repo → resolve owner/repo + installation so PRIVATE repos resolve
    // their head SHA authenticated; legacy public URL → anonymous.
    const boundRepoId = input.gitRepoId;
    if (boundRepoId) {
      const bound = await Result.tryPromise({
        try: () => resolveRepoCloneBinding(boundRepoId),
        catch: (e) => (e instanceof Error ? e.message : String(e)),
      });
      if (bound.isErr()) return Result.err(bound.error);
      const shaRes = await Result.tryPromise({
        try: () =>
          fetchBranchHeadSha(bound.value.githubInstallationId, bound.value.owner, bound.value.repo, branch),
        catch: (e) => (e instanceof Error ? e.message : String(e)),
      });
      if (shaRes.isErr()) {
        return Result.err(`Couldn't resolve ${branch} on ${bound.value.fullName}: ${shaRes.error}`);
      }
      sha = shaRes.value;
    } else {
      const gh = parseGitHubUrl(input.gitRepoUrl);
      if (!gh) return Result.err(`Not a cloneable GitHub URL: ${input.gitRepoUrl}`);
      const shaRes = await Result.tryPromise({
        try: () => fetchBranchHeadSha(null, gh.owner, gh.repo, branch),
        catch: (e) => (e instanceof Error ? e.message : String(e)),
      });
      if (shaRes.isErr()) {
        return Result.err(`Couldn't resolve ${branch} on ${gh.owner}/${gh.repo}: ${shaRes.error}`);
      }
      sha = shaRes.value;
    }
  }

  const [dep] = await db
    .insert(deployment)
    .values({
      resourceId: input.resourceId,
      image: `pending:${sha.slice(0, 12)}`,
      reason: input.reason,
      status: "pending",
      gitSha: sha,
      gitRef: input.gitRef,
    })
    .returning({ id: deployment.id });

  await triggerDeploy({
    projectId: input.projectId,
    gitRepoId: input.gitRepoId ?? input.resourceId,
    ref: input.gitRef,
    sha,
    deploymentIds: [dep?.id ?? ""],
  });
  return Result.ok({ sha });
}
