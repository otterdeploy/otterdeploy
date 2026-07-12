/**
 * `installation_repositories` webhook — fired when the install's repo
 * selection is narrowed/widened in the GitHub UI.
 */

import { db } from "@otterdeploy/db";
import { gitInstallation, gitRepo } from "@otterdeploy/db/schema";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { log } from "evlog";

import type { GithubWebhookResult, InstallationReposEvent } from "./types";

import { syncRepos } from "./repos";

export async function handleInstallationRepos(
  ev: InstallationReposEvent,
  deliveryId: string,
): Promise<GithubWebhookResult> {
  const installationId = String(ev.installation.id);
  const [existing] = await db
    .select()
    .from(gitInstallation)
    .where(eq(gitInstallation.installationId, installationId))
    .limit(1);

  if (!existing) {
    log.info({
      github: {
        event: "installation_repositories",
        installationId,
        deliveryId,
      },
      msg: "no installation row — connect flow hasn't claimed this install yet",
    });
    return { kind: "installation_repositories", added: 0, removed: 0 };
  }

  let added = 0;
  let removed = 0;

  if (ev.repositories_added?.length) {
    await syncRepos(existing.id, ev.repositories_added);
    added = ev.repositories_added.length;
  }

  if (ev.repositories_removed?.length) {
    const providerRepoIds = ev.repositories_removed.map((r) => String(r.node_id ?? r.id));
    const updated = await db
      .update(gitRepo)
      .set({ installationId: null })
      .where(
        and(
          eq(gitRepo.installationId, existing.id),
          inArray(gitRepo.providerRepoId, providerRepoIds),
        ),
      )
      .returning({ id: gitRepo.id });
    removed = updated.length;
  }

  // Keep the stored (GitHub-truth) count in step. Delta arithmetic off the
  // webhook's own added/removed lists is exact when a full sync has set a
  // baseline; a null baseline stays null ("unknown") — a delta can't invent
  // a total, only the next full sync can.
  if (ev.repositories_added?.length || ev.repositories_removed?.length) {
    const delta = (ev.repositories_added?.length ?? 0) - (ev.repositories_removed?.length ?? 0);
    await db
      .update(gitInstallation)
      .set({
        repoCount: sql`greatest(${gitInstallation.repoCount} + ${delta}::int, 0)`,
      })
      .where(and(eq(gitInstallation.id, existing.id), isNotNull(gitInstallation.repoCount)));
  }

  return { kind: "installation_repositories", added, removed };
}
