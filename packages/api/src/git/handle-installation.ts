/**
 * `installation` webhook handler.
 *
 * Phase 1 caveat: we don't create new gitProvider/gitInstallation rows from
 * the webhook itself — the connect flow (Phase 2) is the only writer that
 * knows which org a given install belongs to. The webhook only updates
 * rows that the connect flow has already claimed by installation id.
 */

import { db } from "@otterdeploy/db";
import { gitInstallation, gitRepo } from "@otterdeploy/db/schema";
import { eq } from "drizzle-orm";
import { log } from "evlog";

import type { GithubWebhookResult, InstallationEvent } from "./types";

import { syncRepos } from "./repos";

export async function handleInstallation(
  ev: InstallationEvent,
  deliveryId: string,
): Promise<GithubWebhookResult> {
  const installationId = String(ev.installation.id);
  const [existing] = await db
    .select()
    .from(gitInstallation)
    .where(eq(gitInstallation.installationId, installationId))
    .limit(1);

  if (ev.action === "deleted") {
    if (!existing) {
      log.info({
        github: { event: "installation.deleted", installationId, deliveryId },
        msg: "delete for unknown installation — nothing to do",
      });
      return { kind: "installation", action: ev.action, installationId };
    }
    await db.transaction(async (tx) => {
      await tx
        .update(gitInstallation)
        // repoCount → null: the install is gone on GitHub's side, so the
        // count is unknowable — the UI shows "—" rather than a stale number.
        .set({ revokedAt: new Date(), repoCount: null })
        .where(eq(gitInstallation.id, existing.id));
      await tx
        .update(gitRepo)
        .set({ installationId: null })
        .where(eq(gitRepo.installationId, existing.id));
    });
    return { kind: "installation", action: ev.action, installationId };
  }

  if (ev.action === "suspend" || ev.action === "unsuspend") {
    if (!existing) {
      return { kind: "installation", action: ev.action, installationId };
    }
    await db
      .update(gitInstallation)
      .set({ suspendedAt: ev.action === "suspend" ? new Date() : null })
      .where(eq(gitInstallation.id, existing.id));
    return { kind: "installation", action: ev.action, installationId };
  }

  if (ev.action === "created" && !existing) {
    log.info({
      github: {
        event: "installation.created",
        installationId,
        deliveryId,
        account: ev.installation.account.login,
      },
      msg: "no pre-staged org binding — waiting for connect flow to claim",
    });
    return { kind: "installation", action: ev.action, installationId };
  }

  if (!existing) {
    return { kind: "installation", action: ev.action, installationId };
  }

  // Existing install — refresh metadata + repo set.
  await db
    .update(gitInstallation)
    .set({
      accountLogin: ev.installation.account.login,
      accountType: ev.installation.account.type === "Organization" ? "organization" : "user",
      accountAvatarUrl: ev.installation.account.avatar_url ?? null,
      repoSelection: ev.installation.repository_selection,
      permissions: ev.installation.permissions ?? {},
      suspendedAt: null,
      revokedAt: null,
    })
    .where(eq(gitInstallation.id, existing.id));

  if (ev.repositories?.length) {
    await syncRepos(existing.id, ev.repositories);
  }

  return { kind: "installation", action: ev.action, installationId };
}
