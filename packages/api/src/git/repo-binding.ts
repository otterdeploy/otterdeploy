/**
 * Resolve a `git_repo` binding (by id) into everything a build needs to CLONE
 * it: the clone URL, owner/repo, default branch, and — crucially — the GitHub
 * *numeric* installation id for minting a short-lived clone token on PRIVATE
 * repos.
 *
 * This translation (internal `git_installation.id` FK → GitHub numeric
 * installation id) was duplicated inline in the builder's `load.ts` (git
 * services) and `manifest-apply-git.ts`. Compose now needs the exact same
 * resolution, so it lives here and both the API (create/enqueue) and the build
 * worker (`compose-build.ts`, via `@otterdeploy/api/git/repo-binding`) call it.
 *
 * Gated on `isPrivate`, mirroring services: a public repo clones fine over
 * anonymous HTTPS, so a public repo whose installation was later orphaned (app
 * removed/reconnected) still builds; only a private repo hard-fails with a
 * reconnect hint.
 */
import type { GitRepoId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { gitInstallation, gitRepo } from "@otterdeploy/db/schema";
import { TaggedError } from "better-result";
import { eq } from "drizzle-orm";

export class RepoBindingError extends TaggedError("RepoBindingError")<{
  message: string;
}>() {
  constructor(message: string) {
    super({ message });
  }
}

export interface RepoCloneBinding {
  gitRepoId: GitRepoId;
  /** `owner/repo`. */
  fullName: string;
  owner: string;
  repo: string;
  cloneUrl: string;
  defaultBranch: string;
  isPrivate: boolean;
  /** GitHub NUMERIC installation id for token minting, or null when the repo
   *  clones anonymously (public, or no installation linked). */
  githubInstallationId: string | null;
}

/**
 * Load + resolve the clone binding for a `git_repo`. Throws `RepoBindingError`
 * when the repo row is missing, its `full_name` is malformed, or a PRIVATE
 * repo's installation can't be resolved (needs a reconnect).
 */
export async function resolveRepoCloneBinding(id: GitRepoId): Promise<RepoCloneBinding> {
  const [repo] = await db.select().from(gitRepo).where(eq(gitRepo.id, id)).limit(1);
  if (!repo) {
    throw new RepoBindingError(`git_repo ${id} not found`);
  }
  const [owner, repoName] = repo.fullName.split("/");
  if (!owner || !repoName) {
    throw new RepoBindingError(`git_repo ${id} has a malformed full_name "${repo.fullName}"`);
  }

  let githubInstallationId: string | null = null;
  if (repo.installationId && repo.isPrivate) {
    const [inst] = await db
      .select({ installationId: gitInstallation.installationId })
      .from(gitInstallation)
      .where(eq(gitInstallation.id, repo.installationId))
      .limit(1);
    if (!inst) {
      throw new RepoBindingError(
        `git_installation ${repo.installationId} not found — reconnect GitHub in Settings → Git Providers`,
      );
    }
    githubInstallationId = inst.installationId;
  }

  return {
    gitRepoId: id,
    fullName: repo.fullName,
    owner,
    repo: repoName,
    cloneUrl: repo.cloneUrl,
    defaultBranch: repo.defaultBranch,
    isPrivate: repo.isPrivate,
    githubInstallationId,
  };
}
