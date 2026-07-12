/**
 * Repo upsert helper, shared by every installation event that lands a
 * fresh repo list (installation.created, installation_repositories.added).
 */

import type { GitInstallationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { gitRepo } from "@otterdeploy/db/schema";
import { and, eq, notInArray } from "drizzle-orm";

import type { GithubRepoPayload } from "./types";

export async function syncRepos(
  installationDbId: GitInstallationId,
  repos: GithubRepoPayload[],
  opts?: {
    /**
     * Treat `repos` as the COMPLETE list for this installation and soft-unlink
     * (installationId → null, same as the webhook `removed` path) any row that
     * isn't in it. Only the full-list callers (install callback, "Sync now")
     * set this — webhook deltas must not, they carry partial lists.
     */
    prune?: boolean;
  },
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

  if (opts?.prune) {
    const keep = repos.map((r) => String(r.node_id ?? r.id));
    await db
      .update(gitRepo)
      .set({ installationId: null })
      .where(
        and(
          eq(gitRepo.installationId, installationDbId),
          // notInArray rejects empty lists — an empty `repos` means GitHub
          // grants nothing, so every row of this installation unlinks.
          keep.length > 0 ? notInArray(gitRepo.providerRepoId, keep) : undefined,
        ),
      );
  }
}
