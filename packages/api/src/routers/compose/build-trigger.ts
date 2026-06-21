/**
 * Hand a git-sourced compose stack to the build worker. Kept out of the oRPC
 * handlers (`index.ts`) because it's a distinct concern: resolve the branch
 * head, open a deployment, and enqueue — the builder then clones, builds any
 * `build:` services, fetches + persists the compose file, and deploys.
 */
import { Result } from "better-result";

import { db } from "@otterdeploy/db";
import { deployment } from "@otterdeploy/db/schema/project";
import { triggerDeploy } from "@otterdeploy/jobs";
import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { fetchBranchHeadSha } from "../../git/github-app";
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
  /** Project's bound repo id — logging-only in the job; falls back to the
   *  stack resource id (the build loads the clone URL off the compose row). */
  projectGitRepoId: string | null;
  reason: "create" | "redeploy";
  /** Pre-resolved head SHA (create resolves it before inserting the row, to
   *  fail fast on a bad branch); omitted on redeploy so we resolve it here. */
  sha?: string;
}): Promise<Result<{ sha: string }, string>> {
  let sha = input.sha;
  if (!sha) {
    const gh = parseGitHubUrl(input.gitRepoUrl);
    if (!gh) return Result.err(`Not a cloneable GitHub URL: ${input.gitRepoUrl}`);
    const branch = input.gitRef.replace(/^refs\/heads\//, "") || "main";
    const shaRes = await Result.tryPromise({
      try: () => fetchBranchHeadSha(null, gh.owner, gh.repo, branch),
      catch: (e) => (e instanceof Error ? e.message : String(e)),
    });
    if (shaRes.isErr()) {
      return Result.err(
        `Couldn't resolve ${branch} on ${gh.owner}/${gh.repo}: ${shaRes.error}`,
      );
    }
    sha = shaRes.value;
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
    gitRepoId: input.projectGitRepoId ?? input.resourceId,
    ref: input.gitRef,
    sha,
    deploymentIds: [dep?.id ?? ""],
  });
  return Result.ok({ sha });
}
