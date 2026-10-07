/**
 * A revoked GitHub App installation stays revoked when GitHub redelivers or
 * reorders its webhooks. A late `created`, or a `new_permissions_accepted`,
 * is no proof the binding is wanted again: only the connect flow, which knows
 * the organization that claims it, brings a revoked row back. A live
 * installation still takes the refresh.
 *
 * Real Postgres, real webhook handler.
 */
import type { GitRepoId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { gitInstallation, gitRepo } from "@otterdeploy/db/schema/git";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import type { InstallationEvent } from "../types";

import { seedGitRepo, seedOrganization, uniq } from "../../__tests__/postgres-seed";
import { handleInstallation } from "../handle-installation";

async function bindRepo(): Promise<{ repoId: GitRepoId; installationId: string }> {
  const organizationId = await seedOrganization("git-install");
  const repoId = await seedGitRepo(organizationId, `acme-${uniq()}/app`);
  const [row] = await db
    .select({ installationId: gitInstallation.installationId })
    .from(gitRepo)
    .innerJoin(gitInstallation, eq(gitInstallation.id, gitRepo.installationId))
    .where(eq(gitRepo.id, repoId));
  if (!row) throw new Error("seeded repo has no installation");
  return { repoId, installationId: row.installationId };
}

function event(installationId: string, action: string, login = "acme"): InstallationEvent {
  return {
    action,
    installation: {
      id: installationId,
      account: { id: 1, login, type: "Organization" },
      repository_selection: "selected",
      permissions: { contents: "read" },
    },
  };
}

async function readInstallation(installationId: string) {
  const [row] = await db
    .select({ revokedAt: gitInstallation.revokedAt, accountLogin: gitInstallation.accountLogin })
    .from(gitInstallation)
    .where(eq(gitInstallation.installationId, installationId));
  if (!row) throw new Error(`installation ${installationId} vanished`);
  return row;
}

describe("installation webhooks against a revoked installation", () => {
  it("a redelivered `created` after GitHub deleted the installation does not bring it back", async () => {
    const { installationId } = await bindRepo();
    await handleInstallation(event(installationId, "deleted"), `d-${uniq()}`);
    expect((await readInstallation(installationId)).revokedAt).not.toBeNull();

    await handleInstallation(event(installationId, "created", "renamed"), `d-${uniq()}`);
    const after = await readInstallation(installationId);
    expect(after.revokedAt).not.toBeNull();
    expect(after.accountLogin).not.toBe("renamed");
  });

  it("`new_permissions_accepted` neither revives it nor rebinds its repos", async () => {
    const { repoId, installationId } = await bindRepo();
    await handleInstallation(event(installationId, "deleted"), `d-${uniq()}`);

    await handleInstallation(event(installationId, "new_permissions_accepted"), `d-${uniq()}`);
    expect((await readInstallation(installationId)).revokedAt).not.toBeNull();
    const [repo] = await db
      .select({ installationId: gitRepo.installationId })
      .from(gitRepo)
      .where(eq(gitRepo.id, repoId));
    expect(repo?.installationId).toBeNull();
  });

  it("a live installation still takes the refresh", async () => {
    const { installationId } = await bindRepo();
    await handleInstallation(
      event(installationId, "new_permissions_accepted", "renamed"),
      `d-${uniq()}`,
    );
    expect(await readInstallation(installationId)).toEqual({
      revokedAt: null,
      accountLogin: "renamed",
    });
  });
});
