/**
 * Repo upsert helper, shared by every installation event that lands a
 * fresh repo list (installation.created, installation_repositories.added).
 */

import { db } from "@otterdeploy/db";
import { gitRepo } from "@otterdeploy/db/schema";
import type { ID_PREFIX, Id } from "@otterdeploy/shared/id";

import type { GithubRepoPayload } from "./types";

export async function syncRepos(
  installationDbId: Id<typeof ID_PREFIX.gitInstallation>,
  repos: GithubRepoPayload[],
) {
  // Per-row upsert by providerRepoId. Payloads are small (GitHub caps these
  // webhooks at ~50 repos per delivery) so the loop is fine.
  for (const r of repos) {
    const values = {
      installationId: installationDbId,
      providerRepoId: String(r.node_id ?? r.id),
      fullName: r.full_name,
      defaultBranch: r.default_branch ?? "main",
      isPrivate: r.private ?? true,
      cloneUrl: r.clone_url ?? `https://github.com/${r.full_name}.git`,
    };
    await db
      .insert(gitRepo)
      .values(values)
      .onConflictDoUpdate({
        target: gitRepo.providerRepoId,
        set: {
          installationId: values.installationId,
          fullName: values.fullName,
          defaultBranch: values.defaultBranch,
          isPrivate: values.isPrivate,
          cloneUrl: values.cloneUrl,
        },
      });
  }
}
