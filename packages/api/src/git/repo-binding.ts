/**
 * Resolve a `git_repo` binding (by id) into everything a build needs to CLONE
 * it: the clone URL, owner/repo, default branch, and (crucially) the GitHub
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
 *
 * Tenant-scoped: the id is caller-supplied on compose create and
 * manifest apply, so the repo must resolve to the caller's own organization
 * through installation → provider. Same rule as `getRepoForOrg`: a repo with
 * no installation is a shared public-URL row any org may build from; one with
 * an installation that belongs to another org is reported as not found, so
 * its installation token is never minted and its name never echoed back.
 */
import type { GitRepoId, OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { gitInstallation, gitProvider, gitRepo } from "@otterdeploy/db/schema";
import { TaggedError } from "better-result";
import { eq } from "drizzle-orm";

class RepoBindingError extends TaggedError("RepoBindingError")<{
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
 * Load + resolve the clone binding for a `git_repo` owned by `organizationId`.
 * Throws `RepoBindingError` when the repo row is missing or belongs to another
 * organization, its `full_name` is malformed, or a PRIVATE repo's installation
 * can't be resolved (needs a reconnect).
 */
export async function resolveRepoCloneBinding(
  id: GitRepoId,
  organizationId: OrganizationId,
): Promise<RepoCloneBinding> {
  const [row] = await db
    .select({ repo: gitRepo, providerOrganizationId: gitProvider.organizationId })
    .from(gitRepo)
    .leftJoin(gitInstallation, eq(gitInstallation.id, gitRepo.installationId))
    .leftJoin(gitProvider, eq(gitProvider.id, gitInstallation.providerId))
    .where(eq(gitRepo.id, id))
    .limit(1);
  if (!row || (row.repo.installationId !== null && row.providerOrganizationId !== organizationId)) {
    throw new RepoBindingError(`git_repo ${id} not found`);
  }
  const { repo } = row;
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
        `git_installation ${repo.installationId} not found, reconnect GitHub in Settings → Git Providers`,
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
