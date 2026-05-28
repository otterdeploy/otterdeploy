/**
 * `installation_repositories` webhook — fired when the install's repo
 * selection is narrowed/widened in the GitHub UI.
 */

import { db } from "@otterdeploy/db";
import { gitInstallation, gitRepo } from "@otterdeploy/db/schema";
import { log } from "evlog";
import { and, eq, inArray } from "drizzle-orm";

import { syncRepos } from "./repos";
import type {
  GithubWebhookResult,
  InstallationReposEvent,
} from "./types";

export async function handleInstallationRepos(
  ev: InstallationReposEvent,
  deliveryId: string,
): Promise<GithubWebhookResult> {
  const installationId = String(ev.installation.id);
  const existing = await db.query.gitInstallation.findFirst({
    where: eq(gitInstallation.installationId, installationId),
  });

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
    const providerRepoIds = ev.repositories_removed.map((r) =>
      String(r.node_id ?? r.id),
    );
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

  return { kind: "installation_repositories", added, removed };
}
